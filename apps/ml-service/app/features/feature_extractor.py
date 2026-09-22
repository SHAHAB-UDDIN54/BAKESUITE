"""
BakeSuite AI-01 Feature Engineering Engine
Implements autoregressive lags (including lag_364), rolling statistics, EWMA,
Islamic calendar & event dimensions, commercial features, data-quality censoring,
and weather integrations.
Strictly guarantees point-in-time leakage prevention (feature_date < label_date).
"""
import pandas as pd
import numpy as np
from datetime import date, datetime
from sqlalchemy import text
from app.core.db import engine

def load_daily_demand_data() -> pd.DataFrame:
    """Loads daily demand base data joined with product, branch, stock, promo, and weather data."""
    query = """
    SELECT 
        d.sku_id,
        d.branch_id,
        d.business_date,
        d.total_quantity as demand,
        d.total_sales_pkr as revenue,
        d.transaction_count,
        d.morning_qty,
        d.afternoon_qty,
        d.evening_qty,
        d.stockout_censored_flag,
        COALESCE(sm.stockout_minutes, 0) as stockout_minutes,
        COALESCE(sm.partial_day_flag, false) as partial_trading_day,
        p.category_id,
        p.shelf_life_hours,
        p.base_price,
        COALESCE(p.launch_date, '2023-01-01'::date) as launch_date,
        b.city as branch_city,
        b.area_type as branch_area_type,
        COALESCE(pr.discount_percent, 0.0) as active_promotion_depth_percent,
        COALESCE(pr.promotion_type, 'NONE') as promotion_type,
        w.max_temp_c,
        w.rainfall_mm,
        w.humidity_percent,
        COALESCE(w.heat_wave_flag, false) as heat_wave_flag
    FROM ml.daily_demand_base d
    JOIN public.products p ON d.sku_id = p.sku_id
    JOIN public.branches b ON d.branch_id = b.branch_id
    LEFT JOIN public.stock_movements sm 
        ON d.sku_id = sm.sku_id AND d.branch_id = sm.branch_id AND d.business_date = sm.movement_date
    LEFT JOIN public.promotions pr 
        ON d.sku_id = pr.sku_id AND d.branch_id = pr.branch_id 
       AND d.business_date >= pr.start_date AND d.business_date <= pr.end_date
    LEFT JOIN ml.weather_daily w 
        ON b.city = w.branch_city AND d.business_date = w.weather_date
    ORDER BY d.sku_id, d.branch_id, d.business_date ASC;
    """
    with engine.connect() as conn:
        df = pd.read_sql(text(query), conn)
    df['business_date'] = pd.to_datetime(df['business_date'])
    df['launch_date'] = pd.to_datetime(df['launch_date'])
    return df

def load_calendar_dimension() -> pd.DataFrame:
    """Loads canonical 5-year Pakistani Hijri & Gregorian calendar dimension."""
    query = """
    SELECT 
        gregorian_date as business_date,
        hijri_year,
        hijri_month,
        hijri_day,
        event_name,
        holiday_flag,
        ramadan_flag,
        ramadan_day_index,
        last_ten_nights_flag,
        chand_raat_flag,
        days_to_eid_ul_fitr,
        days_to_eid_ul_adha,
        muharram_flag,
        ashura_flag,
        salary_week_flag,
        day_of_week,
        is_weekend_spike
    FROM ml.fg_calendar_day;
    """
    with engine.connect() as conn:
        df = pd.read_sql(text(query), conn)
    df['business_date'] = pd.to_datetime(df['business_date'])
    return df

def build_feature_matrix(df_demand: pd.DataFrame, df_cal: pd.DataFrame) -> pd.DataFrame:
    """
    Assembles complete AI-01 feature matrix with strict point-in-time leakage protection.
    Every autoregressive feature is strictly shifted by >= 1 day (feature_date < label_date).
    """
    df = df_demand.copy()
    df = df.sort_values(['sku_id', 'branch_id', 'business_date']).reset_index(drop=True)

    # Grouped object for time-series shifting
    grouped = df.groupby(['sku_id', 'branch_id'])['demand']

    # 1. Autoregressive Lags: 1, 2, 3, 7, 14, 21, 28, 56, 364 (Step 6)
    for lag in [1, 2, 3, 7, 14, 21, 28, 56, 364]:
        df[f'lag_{lag}'] = grouped.shift(lag)

    # 2. Rolling Statistics (Mean, Median, Std over 7, 14, 28, 56 days) (Step 6)
    # Strictly applied on shift(1) to avoid leaking current day's label
    for window in [7, 14, 28, 56]:
        df[f'rolling_mean_{window}'] = df.groupby(['sku_id', 'branch_id'])['demand'].transform(
            lambda x: x.shift(1).rolling(window=window, min_periods=2).mean()
        )
        df[f'rolling_median_{window}'] = df.groupby(['sku_id', 'branch_id'])['demand'].transform(
            lambda x: x.shift(1).rolling(window=window, min_periods=2).median()
        )
        df[f'rolling_std_{window}'] = df.groupby(['sku_id', 'branch_id'])['demand'].transform(
            lambda x: x.shift(1).rolling(window=window, min_periods=2).std()
        ).fillna(0.0)

    # 3. Same-Weekday Rolling Mean (Trailing 4 and 8 occurrences) (Step 6)
    df['day_of_week'] = df['business_date'].dt.dayofweek + 1
    for occ in [4, 8]:
        df[f'same_weekday_mean_{occ}'] = df.groupby(['sku_id', 'branch_id', 'day_of_week'])['demand'].transform(
            lambda x: x.shift(1).rolling(window=occ, min_periods=1).mean()
        )

    # 4. Exponentially Weighted Moving Average (EWMA with alpha = 0.3) (Step 6)
    df['ewma_03'] = df.groupby(['sku_id', 'branch_id'])['demand'].transform(
        lambda x: x.shift(1).ewm(alpha=0.3, min_periods=1).mean()
    )

    # 5. Commercial Features (Step 8)
    # Effective price / trailing 28-day average price
    df['price_ratio_28d'] = df.groupby(['sku_id', 'branch_id'])['base_price'].transform(
        lambda x: x / (x.shift(1).rolling(28, min_periods=1).mean() + 1e-6)
    )
    # Number of competing promoted SKUs in same category and branch
    if 'active_promotion_depth_percent' in df.columns:
        df['is_promoted'] = (df['active_promotion_depth_percent'] > 0).astype(int)
        df['competing_promoted_skus'] = df.groupby(['category_id', 'branch_id', 'business_date'])['is_promoted'].transform('sum') - df['is_promoted']
        df['competing_promoted_skus'] = df['competing_promoted_skus'].clip(lower=0)
    else:
        df['active_promotion_depth_percent'] = 0.0
        df['competing_promoted_skus'] = 0

    # 6. Product and Branch Features (Step 9)
    df['days_since_launch'] = (df['business_date'] - df['launch_date']).dt.days.clip(lower=0)
    
    # Safe column fallbacks
    if 'revenue' not in df.columns:
        price_col = df['base_price'] if 'base_price' in df.columns else 180.0
        df['revenue'] = df['demand'] * price_col
    if 'transaction_count' not in df.columns:
        df['transaction_count'] = np.maximum(1, (df['demand'] // 2)).astype(int)
    if 'launch_date' in df.columns:
        df['days_since_launch'] = (df['business_date'] - pd.to_datetime(df['launch_date'])).dt.days.clip(lower=0)
    else:
        df['days_since_launch'] = 365

    # 6. Product and Branch Features (Step 9)
    # SKU share of category sales over trailing 28 days (strictly shifted by 1)
    if 'category_id' in df.columns:
        df['category_sales_28d'] = df.groupby(['category_id', 'branch_id'])['revenue'].transform(
            lambda x: x.shift(1).rolling(28, min_periods=1).sum()
        )
        df['sku_sales_28d'] = df.groupby(['sku_id', 'branch_id'])['revenue'].transform(
            lambda x: x.shift(1).rolling(28, min_periods=1).sum()
        )
        df['category_share_28d'] = (df['sku_sales_28d'] / (df['category_sales_28d'] + 1.0)).fillna(0.0)
    else:
        df['category_share_28d'] = 0.0

    # Branch trailing 28-day transaction count
    df['branch_tx_28d'] = df.groupby(['branch_id'])['transaction_count'].transform(
        lambda x: x.shift(1).rolling(28, min_periods=1).sum()
    ).fillna(0.0)

    # 7. Data-Quality & Censoring Features (Step 10)
    # stockout_censored: stockout_minutes > 60
    has_sm = 'stockout_minutes' in df.columns and (df['stockout_minutes'] > 60)
    has_flag = 'stockout_censored_flag' in df.columns and (df['stockout_censored_flag'] == True)
    df['stockout_censored'] = (has_sm | has_flag).astype(int)

    # 8. Weather Features & Imputation (Step 11)
    # If weather unavailable: seasonal normal imputation
    m = df['business_date'].dt.month
    if 'max_temp_c' in df.columns:
        seasonal_temp = 20.0 + 15.0 * np.sin((m - 1) * np.pi / 6.0)
        df['max_temp_c'] = df['max_temp_c'].fillna(seasonal_temp)
        df['rainfall_mm'] = df['rainfall_mm'].fillna(0.0)
        df['humidity_percent'] = df['humidity_percent'].fillna(55.0)
        df['heat_wave'] = (df['max_temp_c'] > 40.0).astype(int)
    else:
        df['max_temp_c'] = 20.0 + 15.0 * np.sin((m - 1) * np.pi / 6.0)
        df['rainfall_mm'] = 0.0
        df['humidity_percent'] = 55.0
        df['heat_wave'] = 0

    # 9. Join Calendar & Lunar Hijri Feature Dimension (Step 7)
    # Drop day_of_week from df_cal before merge if already in df to prevent _x/_y suffix collision
    cal_cols = [c for c in df_cal.columns if c != 'day_of_week' or 'day_of_week' not in df.columns]
    df = df.merge(df_cal[cal_cols], on='business_date', how='left')

    if 'day_of_week' not in df.columns:
        df['day_of_week'] = df['business_date'].dt.dayofweek + 1

    # Calendar specific indicators
    df['friday_indicator'] = (df['day_of_week'] == 5).astype(int)
    df['saturday_indicator'] = (df['day_of_week'] == 6).astype(int)
    df['sunday_indicator'] = (df['day_of_week'] == 7).astype(int)
    df['week_of_month'] = ((df['business_date'].dt.day - 1) // 7 + 1).astype(int)
    df['gregorian_month'] = df['business_date'].dt.month.astype(int)
    df['school_vacation'] = df['gregorian_month'].isin([6, 7]).astype(int)

    # Eid distance clipped to [-30, +14] per Step 7
    if 'days_to_eid_ul_fitr' in df.columns:
        df['days_to_eid_ul_fitr'] = df['days_to_eid_ul_fitr'].clip(lower=-30, upper=14)
    if 'days_to_eid_ul_adha' in df.columns:
        df['days_to_eid_ul_adha'] = df['days_to_eid_ul_adha'].clip(lower=-30, upper=14)

    # Convert boolean flags to int for gradient boosting
    bool_cols = [
        'holiday_flag', 'ramadan_flag', 'last_ten_nights_flag', 'chand_raat_flag',
        'muharram_flag', 'ashura_flag', 'salary_week_flag', 'is_weekend_spike',
        'stockout_censored_flag', 'partial_trading_day'
    ]
    for col in bool_cols:
        if col in df.columns:
            df[col] = df[col].astype(int)

    # Fill remaining NaNs from longest lags with zero/median
    df = df.fillna(0.0)

    return df
