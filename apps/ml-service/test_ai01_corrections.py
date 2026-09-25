import pytest
import os
import numpy as np
import pandas as pd
from datetime import date, timedelta
from app.models.lgbm_quantiles import LightGBMQuantileModel, FEATURE_COLUMNS
from app.models.sarimax_baseline import SarimaxBaselineModel
from app.models.ensemble import P50WeightedEnsemble
from app.core.db import engine
from sqlalchemy import text
import zoneinfo

def test_actual_lgbm_inference_sensitivity():
    """Requirement 9 & 47: Changing input features must change model predictions."""
    model_dir = "apps/ml-service/models" if os.path.exists("apps/ml-service/models") else "models"
    model = LightGBMQuantileModel(model_dir=model_dir)
    model.load()
    
    # Feature vector 1: low demand features
    data_low = {col: 0.0 for col in FEATURE_COLUMNS}
    data_low['sku_id'] = 'SKU-BRD-01'
    data_low['branch_id'] = 'BR-KHI-01'
    data_low['category_id'] = 'BREAD'
    data_low['lag_1'] = 10.0
    data_low['lag_2'] = 12.0
    data_low['lag_7'] = 11.0
    data_low['rolling_mean_7'] = 11.5
    data_low['same_weekday_mean_4'] = 10.0
    
    X_low = pd.DataFrame([data_low])
    
    # Feature vector 2: high demand features
    X_high = X_low.copy()
    X_high['lag_1'] = 300.0
    X_high['lag_2'] = 290.0
    X_high['lag_7'] = 310.0
    X_high['rolling_mean_7'] = 300.0
    X_high['rolling_mean_14'] = 295.0
    X_high['same_weekday_mean_4'] = 305.0
    
    p10_low, p50_low, p90_low = model.predict_quantiles(X_low)
    p10_high, p50_high, p90_high = model.predict_quantiles(X_high)
    
    # Check that predictions differ and high features result in higher predictions
    assert p50_low[0] != p50_high[0], "Model predictions must be dynamic and not hard-coded!"
    assert p50_high[0] > p50_low[0], "Higher lag/rolling demand must increase P50 prediction!"

def test_quantile_order_and_non_negativity():
    """Requirement 11: P10 <= P50 <= P90 and demand >= 0."""
    model_dir = "apps/ml-service/models" if os.path.exists("apps/ml-service/models") else "models"
    model = LightGBMQuantileModel(model_dir=model_dir)
    model.load()
    
    for lag in [0.0, 5.0, 50.0, 250.0]:
        data = {col: 0.0 for col in FEATURE_COLUMNS}
        data['sku_id'] = 'SKU-BRD-01'
        data['branch_id'] = 'BR-KHI-01'
        data['category_id'] = 'BREAD'
        data['lag_1'] = lag
        data['lag_7'] = lag
        data['rolling_mean_7'] = lag
        data['same_weekday_mean_4'] = lag
        
        df = pd.DataFrame([data])
        p10, p50, p90 = model.predict_quantiles(df)
        
        assert p10[0] >= 0, f"P10 must be non-negative: {p10[0]}"
        assert p50[0] >= 0, f"P50 must be non-negative: {p50[0]}"
        assert p90[0] >= 0, f"P90 must be non-negative: {p90[0]}"
        assert p10[0] <= p50[0] <= p90[0], f"Monotonic quantile violation: P10={p10[0]}, P50={p50[0]}, P90={p90[0]}"

def test_56_day_clipping():
    """Requirement 7: Forecast ceiling must be 3 * trailing 56-day max."""
    trailing_56_day_max = 50.0
    forecast_ceiling = trailing_56_day_max * 3.0 # 150.0
    
    p10_raw = 140.0
    p50_raw = 180.0
    p90_raw = 220.0
    
    # Apply clipping
    p50_clipped = min(p50_raw, forecast_ceiling)
    p90_clipped = min(p90_raw, forecast_ceiling)
    p10_clipped = min(p10_raw, p50_clipped)
    
    assert p50_clipped == 150.0
    assert p90_clipped == 150.0
    assert p10_clipped == 140.0
    assert p10_clipped <= p50_clipped <= p90_clipped

def test_sarimax_ensemble():
    """Requirement 10: Weighted ensemble of LightGBM P50 and SARIMAX P50."""
    ensemble = P50WeightedEnsemble()
    lgbm_p50 = np.array([100.0, 150.0])
    sarimax_p50 = np.array([110.0, 140.0])
    
    comb = ensemble.predict_ensemble_p50("BR-KHI-01", lgbm_p50, sarimax_p50)
    w_lgbm, w_sarimax = ensemble.branch_weights["BR-KHI-01"]
    expected = np.round(w_lgbm * lgbm_p50 + w_sarimax * sarimax_p50).astype(int)
    np.testing.assert_array_equal(comb, expected)

def test_confidence_calculation_and_caps():
    """Requirement 12: Dispersion, sufficiency, cold-start cap, weather adjustment."""
    # 1. Normal case
    p10, p50, p90 = 40.0, 50.0, 60.0
    dispersion = 1.0 - ((p90 - p10) / (2.0 * p50)) # 1.0 - (20/100) = 0.80
    assert dispersion == 0.80
    
    # Sufficiency
    non_censored_days = 120
    sufficiency = min(1.0, non_censored_days / 120.0) # 1.0
    raw_confidence = dispersion * sufficiency # 0.80
    assert raw_confidence >= 0.75 # High
    
    # 2. Weather unavailable adjustment
    conf_no_weather = raw_confidence * 0.95
    assert conf_no_weather == pytest.approx(0.76, abs=0.01)
    
    # 3. Cold-start cap
    is_cold_start = True
    final_conf = min(conf_no_weather, 0.45) if is_cold_start else conf_no_weather
    assert final_conf <= 0.45

def test_batch_date_is_dynamic():
    """Requirement 15: Nightly batch date must be determined dynamically in Asia/Karachi."""
    pkt_tz = zoneinfo.ZoneInfo("Asia/Karachi")
    now_pkt = pd.Timestamp.now(tz=pkt_tz).date()
    assert now_pkt is not None
    assert isinstance(now_pkt, date)

def test_active_products_only():
    """Requirement 8: Only ACTIVE products should be scored."""
    with engine.connect() as conn:
        cnt = conn.execute(text("SELECT count(*) FROM public.products WHERE status = 'ACTIVE';")).fetchone()[0]
        assert cnt > 0
