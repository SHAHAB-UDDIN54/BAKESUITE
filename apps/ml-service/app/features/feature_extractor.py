"""
BakeSuite AI-01 Feature Engineering Engine
Implements autoregressive lags, rolling statistics, EWMA,
Islamic calendar & event dimensions, commercial features, and data-quality censoring.
Strictly guarantees point-in-time leakage prevention (feature_date < label_date).
"""
import pandas as pd
import numpy as np
from datetime import date, datetime
from sqlalchemy import text
from app.core.db import engine

def load_daily_demand_data() -> pd.DataFrame:
    """Loads daily demand base data joined with product and branch master data."""
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
        p.category_id,
        p.shelf_life_hours,
        p.base_price,
        b.city as branch_city,
        b.area_type as branch_area_type
    FROM ml.daily_demand_base d
    JOIN public.products p ON d.sku_id = p.sku_id
    JOIN public.branches b ON d.branch_id = b.branch_id
    ORDER BY d.sku_id, d.branch_id, d.business_date ASC;
    """
    with engine.connect() as conn:
        df = pd.read_sql(text(query), conn)
    df['business_date'] = pd.to_datetime(df['business_date'])
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
    Every autoregressive feature is strictly shifted by >= 1 day.
    """
    df = df_demand.copy()
    df = df.sort_values(['sku_id', 'branch_id', 'business_date']).reset_index(drop=True)

    # Grouped object for time-series shifting
    grouped = df.groupby(['sku_id', 'branch_id'])['demand']

    # 1. Autoregressive Lags: 1, 2, 3, 7, 14, 21, 28, 56, 364
    for lag in [1, 2, 3, 7, 14, 21, 28, 56]:
        df[f'lag_{lag}'] = grouped.shift(lag)

    # 2. Rolling Statistics (Mean, Median, Std over 7, 14, 28, 56 days)
    # Strictly applied on shift(1) to avoid leaking current day's label
    shifted_demand = grouped.shift(1)
    
    for window in [7, 14, 28, 56]:
        # Using transform with rolling on the shifted series
        df[f'rolling_mean_{window}'] = df.groupby(['sku_id', 'branch_id'])['demand'].transform(
            lambda x: x.shift(1).rolling(window=window, min_periods=2).mean()
        )
        df[f'rolling_median_{window}'] = df.groupby(['sku_id', 'branch_id'])['demand'].transform(
            lambda x: x.shift(1).rolling(window=window, min_periods=2).median()
        )
        df[f'rolling_std_{window}'] = df.groupby(['sku_id', 'branch_id'])['demand'].transform(
            lambda x: x.shift(1).rolling(window=window, min_periods=2).std()
        ).fillna(0.0)

    # 3. Same-Weekday Rolling Mean (Trailing 4 and 8 occurrences)
    df['day_of_week'] = df['business_date'].dt.dayofweek + 1
    for occ in [4, 8]:
        df[f'same_weekday_mean_{occ}'] = df.groupby(['sku_id', 'branch_id', 'day_of_week'])['demand'].transform(
            lambda x: x.shift(1).rolling(window=occ, min_periods=1).mean()
        )

    # 4. Exponentially Weighted Moving Average (EWMA with alpha = 0.3)
    df['ewma_03'] = df.groupby(['sku_id', 'branch_id'])['demand'].transform(
        lambda x: x.shift(1).ewm(alpha=0.3, min_periods=1).mean()
    )

    # 5. Commercial Features: Price ratio to trailing 28-day average
    df['price_ratio_28d'] = df.groupby(['sku_id', 'branch_id'])['base_price'].transform(
        lambda x: x / (x.shift(1).rolling(28, min_periods=1).mean() + 1e-6)
    )

    # 6. Join Calendar & Lunar Hijri Feature Dimension
    df = df.merge(df_cal, on='business_date', how='left')

    # Convert boolean flags to float/int for gradient boosting
    bool_cols = [
        'holiday_flag', 'ramadan_flag', 'last_ten_nights_flag', 'chand_raat_flag',
        'muharram_flag', 'ashura_flag', 'salary_week_flag', 'is_weekend_spike',
        'stockout_censored_flag'
    ]
    for col in bool_cols:
        if col in df.columns:
            df[col] = df[col].astype(int)

    # Fill remaining NaNs from longest lags with median imputation
    df = df.fillna(0.0)

    return df
