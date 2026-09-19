"""
Phase 10: Point-in-Time Leakage Validation Test Suite
Automated tests ensuring strictly feature_date < label_date across all computed features.
"""
import pytest
import pandas as pd
import numpy as np
from app.features.feature_extractor import load_daily_demand_data, load_calendar_dimension, build_feature_matrix

@pytest.fixture(scope="module")
def feature_df():
    df_demand = load_daily_demand_data()
    df_cal = load_calendar_dimension()
    return build_feature_matrix(df_demand, df_cal)

def test_feature_matrix_shape_and_columns(feature_df):
    assert len(feature_df) > 10000, f"Expected >10k rows, got {len(feature_df)}"
    
    # Verify presence of all required feature groups
    required_cols = [
        'lag_1', 'lag_2', 'lag_3', 'lag_7', 'lag_14', 'lag_28',
        'rolling_mean_7', 'rolling_mean_14', 'rolling_mean_28', 'rolling_std_7',
        'same_weekday_mean_4', 'same_weekday_mean_8',
        'ewma_03', 'price_ratio_28d',
        'ramadan_flag', 'last_ten_nights_flag', 'chand_raat_flag',
        'days_to_eid_ul_fitr', 'is_weekend_spike'
    ]
    for col in required_cols:
        assert col in feature_df.columns, f"Missing feature column: {col}"

def test_point_in_time_lag1_leakage_free(feature_df):
    """Verifies that lag_1 at day t strictly equals demand at day t-1."""
    df = feature_df.sort_values(['sku_id', 'branch_id', 'business_date']).reset_index(drop=True)
    
    # Pick a sample SKU and branch
    sample = df[(df['sku_id'] == 'SKU-BRD-01') & (df['branch_id'] == 'BR-KHI-01')].copy()
    sample = sample.sort_values('business_date').reset_index(drop=True)

    # For rows 1..N, lag_1 must match demand at row-1
    for i in range(1, min(50, len(sample))):
        prev_demand = sample.loc[i - 1, 'demand']
        curr_lag1 = sample.loc[i, 'lag_1']
        assert prev_demand == curr_lag1, f"Leakage detected! Day {i}: prev_demand={prev_demand}, lag_1={curr_lag1}"

def test_rolling_mean_does_not_contain_current_label(feature_df):
    """
    Verifies that rolling statistics do NOT leak the current day's label.
    If current day's demand is artificially spiked, rolling_mean_7 on that same day must remain unchanged.
    """
    df_demand = load_daily_demand_data()
    df_cal = load_calendar_dimension()
    
    # Take baseline
    matrix1 = build_feature_matrix(df_demand.copy(), df_cal)
    
    # Modify a specific day's demand label
    df_mod = df_demand.copy()
    idx_to_mod = 100
    original_demand = df_mod.loc[idx_to_mod, 'demand']
    df_mod.loc[idx_to_mod, 'demand'] = original_demand + 5000  # Massive spike
    
    matrix2 = build_feature_matrix(df_mod, df_cal)

    # Check rolling_mean_7 at idx_to_mod on the modified day:
    # Because it uses shift(1), rolling_mean_7 on THAT day must NOT see the +5000 spike!
    m1_val = matrix1.loc[idx_to_mod, 'rolling_mean_7']
    m2_val = matrix2.loc[idx_to_mod, 'rolling_mean_7']
    
    assert m1_val == m2_val, f"Leakage violation! Same-day demand spike altered rolling_mean_7 ({m1_val} vs {m2_val})"
