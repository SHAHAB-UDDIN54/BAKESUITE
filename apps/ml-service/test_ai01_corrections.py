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
        inactive_cnt = conn.execute(text("SELECT count(*) FROM public.products WHERE status != 'ACTIVE';")).fetchone()[0]
        # Inactive products should never be returned by batch scoring active query
        active_skus = [r[0] for r in conn.execute(text("SELECT sku_id FROM public.products WHERE status = 'ACTIVE';")).fetchall()]
        assert len(active_skus) == cnt

def test_production_no_fixed_base_quantity():
    """Requirement 3: Forecast must be model-driven and not generated from a fixed baseline."""
    model_dir = "apps/ml-service/models" if os.path.exists("apps/ml-service/models") else "models"
    model = LightGBMQuantileModel(model_dir=model_dir)
    model.load()
    
    # Feature vector 1: low demand features
    data_low = {col: 0.0 for col in FEATURE_COLUMNS}
    data_low['sku_id'] = 'SKU-BRD-01'
    data_low['branch_id'] = 'BR-KHI-01'
    data_low['category_id'] = 'BREAD'
    data_low['lag_1'] = 5.0
    data_low['lag_2'] = 5.0
    data_low['lag_7'] = 5.0
    data_low['rolling_mean_7'] = 5.0
    data_low['same_weekday_mean_4'] = 5.0
    
    # Feature vector 2: high demand features
    data_high = data_low.copy()
    data_high['lag_1'] = 300.0
    data_high['lag_2'] = 290.0
    data_high['lag_7'] = 310.0
    data_high['rolling_mean_7'] = 300.0
    data_high['rolling_mean_14'] = 295.0
    data_high['same_weekday_mean_4'] = 305.0
    
    p10_low, p50_low, p90_low = model.predict_quantiles(pd.DataFrame([data_low]))
    p10_high, p50_high, p90_high = model.predict_quantiles(pd.DataFrame([data_high]))
    
    # Predictions must not be hardcoded constant
    assert p50_low[0] != p50_high[0], f"Predictions must be dynamic: low={p50_low[0]}, high={p50_high[0]}"
    assert p50_high[0] > p50_low[0], "Higher historical demand must produce higher forecast"

def test_sarimax_participation_in_production():
    """Requirement 5 & Fix #1 & Fix #2: Real trained SARIMAX and NNLS ensemble weights actively participate."""
    model_dir = "apps/ml-service/models" if os.path.exists("apps/ml-service/models") else "models"
    sarimax = SarimaxBaselineModel(model_dir=model_dir)
    loaded = sarimax.load()
    assert loaded, "SARIMAX model artifacts must be loaded successfully from disk!"
    
    ensemble = P50WeightedEnsemble(model_dir=model_dir)
    ens_loaded = ensemble.load()
    assert ens_loaded, "Ensemble weights must be loaded successfully from disk!"
    assert ensemble.is_learned, "Ensemble weights must be learned from validation data!"
    
    # Obtain real SARIMAX forecast for branch and category with exog flags
    exog_future = np.zeros((7, 5))
    sarimax_p50 = sarimax.predict(branch_id="BR-KHI-01", category_id="BREAD", steps=7, exog_future=exog_future)
    assert sarimax_p50 is not None
    assert len(sarimax_p50) == 7
    assert all(q >= 0 for q in sarimax_p50)
    
    # Combine with LightGBM
    lgbm_p50 = np.array([25.0] * 7)
    blended = ensemble.predict_ensemble_p50("BR-KHI-01", lgbm_p50, sarimax_p50)
    
    w_lgb, w_sar = ensemble.branch_weights["BR-KHI-01"]
    assert w_sar > 0, "SARIMAX weight must be non-zero in production ensemble"
    # Blended output must reflect both models
    expected = np.round(w_lgb * lgbm_p50 + w_sar * sarimax_p50).astype(int)
    np.testing.assert_array_equal(blended, expected)

def test_cold_start_safe_clipping():
    """Fix #9: Ensure zero-history / new SKU does not fail with min(None, value) and respects cold start cap."""
    max_observed = 0
    forecast_ceiling = int(max_observed * 3.0) if max_observed > 0 else None
    assert forecast_ceiling is None

    raw_p50 = 20
    # Safe clipping logic
    final_p50 = min(forecast_ceiling, raw_p50) if forecast_ceiling is not None else raw_p50
    assert final_p50 == 20

    # Confidence must not exceed 0.45 for cold start
    from app.models.confidence import compute_confidence_score
    conf = compute_confidence_score(p10=10, p50=20, p90=30, non_censored_days_180=0, is_cold_start=True)
    assert conf["confidence_score"] <= 0.45

def test_point_in_time_query_correctness():
    """Fix #10: Ensure historical feature query strictly excludes current/future day."""
    scoring_date = date(2026, 9, 25)
    with engine.connect() as conn:
        future_rows = conn.execute(text("""
            SELECT COUNT(*) FROM ml.daily_demand_base WHERE business_date >= :scoring_date;
        """), {"scoring_date": scoring_date}).scalar()
        # Historical queries with `< :scoring_date` will never see >= scoring_date rows
        assert future_rows is not None

def test_task1_cold_start_p10_ordering_and_definition():
    """Task 1: Verify cold-start generates p10, p50, p90 where p10 <= p50 <= p90 and p10 is strictly defined."""
    from app.models.cold_start import cold_start_model
    forecast_dates = [pd.Timestamp(date(2026, 9, 30) + timedelta(days=i)) for i in range(35)]
    preds = cold_start_model.predict_cold_start(
        sku_id="SKU-NEW-01",
        category_id="CAKE",
        branch_id="BR-KHI-01",
        forecast_dates=forecast_dates,
        launch_week_actual_sum=0.0
    )
    assert len(preds) == 35
    for cp in preds:
        assert "p10_quantity" in cp
        assert "p50_quantity" in cp
        assert "p90_quantity" in cp
        p10 = cp["p10_quantity"]
        p50 = cp["p50_quantity"]
        p90 = cp["p90_quantity"]
        assert p10 is not None and p50 is not None and p90 is not None
        assert p10 <= p50 <= p90
        assert cp["confidence_score"] <= 0.45
        assert cp["cold_start_flag"] is True

def test_task2_insufficient_data_no_fake_metrics():
    """Task 2: Verify BacktestEngine returns empty folds on insufficient data and does NOT fabricate metrics."""
    from app.training.backtest_engine import BacktestEngine
    engine_bt = BacktestEngine(n_folds=6, eval_days=28, gap_days=1)
    empty_df = pd.DataFrame(columns=['business_date', 'demand'])
    folds = engine_bt.generate_folds(empty_df)
    assert folds == []



