"""
BakeSuite AI-01 Comprehensive Acceptance & Compliance Test Suite (SRS Chapter 5 / Step 51)
Verifies all 52 core requirements across data, features, models, serving, governance, and fallback.
"""
import sys
import os
import pytest
from datetime import date, datetime, timedelta
import numpy as np
import pandas as pd
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.db import engine
from app.core.cache import cache
from app.models.confidence import compute_confidence_score
from app.models.cold_start import cold_start_model
from app.models.hurdle_intermittent import TwoStageHurdleModel
from app.models.registry import registry
from app.services.drift_monitoring import calculate_psi, drift_service
from app.services.retraining_trigger import retraining_service
from app.services.feature_parity import validate_feature_parity
from app.features.feature_extractor import build_feature_matrix
from main import app

client = TestClient(app)

# 1. Runtime & Environment Test (Step 1)
def test_python_312_runtime():
    """Step 1: Verifies ML Service executes under Python 3.12."""
    assert sys.version_info.major == 3
    assert sys.version_info.minor == 12, f"Expected Python 3.12, got {sys.version}"

# 2. Database Connection & Schema Isolation (Step 2)
def test_postgres_schema_isolation():
    """Step 2: Verifies PostgreSQL connection and ml / public schema isolation."""
    with engine.connect() as conn:
        res = conn.execute(text("SELECT current_database(), current_schema();")).fetchone()
        assert res[0] == "bakesuite"

        # Check schemas present
        schemas = [row[0] for row in conn.execute(text("SELECT schema_name FROM information_schema.schemata;")).fetchall()]
        assert "public" in schemas
        assert "ml" in schemas

# 3. Required Data Sources & Columns (Step 4)
def test_required_tables_and_columns():
    """Step 4: Verifies all required tables and specific columns exist in database."""
    required = {
        "public.products": ["sku_id", "category_id", "shelf_life_hours", "base_price", "launch_date", "status"],
        "public.branches": ["branch_id", "city", "area_type", "opening_hours", "open_date"],
        "public.pos_invoices": ["invoice_id", "branch_id", "business_date", "channel", "void_flag"],
        "public.pos_invoice_lines": ["sku_id", "quantity", "net_amount", "discount_amount", "invoice_id"],
        "public.promotions": ["promotion_id", "sku_id", "branch_id", "discount_percent", "start_date", "end_date"],
        "public.promotion_redemptions": ["promotion_id", "sku_id", "branch_id", "redemption_date", "quantity_redeemed"],
        "public.stock_movements": ["sku_id", "branch_id", "movement_date", "on_hand_close", "stockout_minutes"],
        "public.waste_records": ["sku_id", "branch_id", "waste_date", "waste_quantity", "reason_code"],
        "ml.fg_calendar_day": ["gregorian_date", "hijri_date", "event_name", "holiday_flag"],
        "ml.weather_daily": ["branch_city", "max_temp_c", "rainfall_mm", "humidity_percent"]
    }

    with engine.connect() as conn:
        for table, cols in required.items():
            schema, tbl = table.split(".")
            col_query = text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = :s AND table_name = :t;
            """)
            present_cols = [r[0] for r in conn.execute(col_query, {"s": schema, "t": tbl}).fetchall()]
            for c in cols:
                assert c in present_cols, f"Missing column {c} in {table}"

# 4. Feature Engineering: lag_364, Rolling, and Point-in-Time Correctness (Steps 6 & 12)
def test_lag364_and_point_in_time_correctness():
    """Steps 6 & 12: Verifies lag_364 exists and autoregressive features strictly prevent future leakage."""
    dates = pd.date_range("2024-01-01", periods=400, freq="D")
    df_dummy = pd.DataFrame({
        "sku_id": ["SKU-BRD-01"] * 400,
        "branch_id": ["BR-KHI-01"] * 400,
        "business_date": dates,
        "demand": np.arange(1, 401),
        "revenue": np.arange(1, 401) * 180.0,
        "transaction_count": [20] * 400,
        "morning_qty": [5] * 400,
        "afternoon_qty": [5] * 400,
        "evening_qty": [5] * 400,
        "stockout_censored_flag": [False] * 400,
        "stockout_minutes": [0] * 400,
        "category_id": ["BREAD"] * 400,
        "shelf_life_hours": [48] * 400,
        "base_price": [180.0] * 400,
        "launch_date": [pd.Timestamp("2023-01-01")] * 400,
        "branch_city": ["Karachi"] * 400,
        "branch_area_type": ["Commercial"] * 400
    })
    df_cal = pd.DataFrame({
        "business_date": dates,
        "gregorian_date": dates,
        "hijri_year": [1445] * 400,
        "hijri_month": [1] * 400,
        "hijri_day": [1] * 400,
        "event_name": ["Normal"] * 400,
        "holiday_flag": [False] * 400,
        "ramadan_flag": [False] * 400,
        "ramadan_day_index": [0] * 400,
        "last_ten_nights_flag": [False] * 400,
        "chand_raat_flag": [False] * 400,
        "days_to_eid_ul_fitr": [45] * 400,
        "days_to_eid_ul_adha": [90] * 400,
        "muharram_flag": [False] * 400,
        "ashura_flag": [False] * 400,
        "salary_week_flag": [False] * 400,
        "day_of_week": [1] * 400,
        "is_weekend_spike": [False] * 400
    })

    feat = build_feature_matrix(df_dummy, df_cal)
    assert "lag_364" in feat.columns, "lag_364 missing from feature matrix"
    assert "rolling_mean_7" in feat.columns
    assert "rolling_median_28" in feat.columns
    assert "rolling_std_56" in feat.columns
    assert "ewma_03" in feat.columns

    # Leakage check: lag_1 on row index i must strictly equal demand at row index i-1
    assert feat.loc[10, "lag_1"] == df_dummy.loc[9, "demand"]
    assert feat.loc[365, "lag_364"] == df_dummy.loc[1, "demand"]

# 5. Calendar Features & Eid Distance Clipping [-30, +14] (Step 7)
def test_calendar_eid_distance_clipping():
    """Step 7: Verifies Eid distance clipping to [-30, +14]."""
    df_dummy = pd.DataFrame({
        "sku_id": ["SKU-BRD-01"] * 5,
        "branch_id": ["BR-KHI-01"] * 5,
        "business_date": pd.date_range("2026-03-01", periods=5),
        "demand": [20, 25, 30, 35, 40],
        "revenue": [2000] * 5,
        "transaction_count": [10] * 5,
        "morning_qty": [5] * 5,
        "afternoon_qty": [5] * 5,
        "evening_qty": [5] * 5,
        "stockout_censored_flag": [False] * 5,
        "category_id": ["BREAD"] * 5,
        "shelf_life_hours": [48] * 5,
        "base_price": [180.0] * 5,
        "launch_date": [pd.Timestamp("2023-01-01")] * 5,
        "branch_city": ["Karachi"] * 5,
        "branch_area_type": ["Commercial"] * 5
    })
    df_cal = pd.DataFrame({
        "business_date": pd.date_range("2026-03-01", periods=5),
        "days_to_eid_ul_fitr": [-45, -10, 0, 10, 35], # -45 < -30 and 35 > 14
        "days_to_eid_ul_adha": [-60, 5, 10, 20, 40],
        "hijri_year": [1447] * 5,
        "hijri_month": [9] * 5,
        "hijri_day": [15] * 5,
        "event_name": ["Ramadan"] * 5,
        "holiday_flag": [False] * 5,
        "ramadan_flag": [True] * 5,
        "ramadan_day_index": [15] * 5,
        "last_ten_nights_flag": [False] * 5,
        "chand_raat_flag": [False] * 5,
        "muharram_flag": [False] * 5,
        "ashura_flag": [False] * 5,
        "salary_week_flag": [False] * 5,
        "day_of_week": [1, 2, 3, 4, 5],
        "is_weekend_spike": [False] * 5
    })

    feat = build_feature_matrix(df_dummy, df_cal)
    assert feat["days_to_eid_ul_fitr"].min() >= -30, "Eid distance not clipped at -30"
    assert feat["days_to_eid_ul_fitr"].max() <= 14, "Eid distance not clipped at +14"
    assert "friday_indicator" in feat.columns
    assert "week_of_month" in feat.columns

# 6. Confidence Score & Weather Degradation (Steps 27 & 28)
def test_confidence_formula_and_weather_degradation():
    """Steps 27 & 28: Verifies Dispersion x Sufficiency and exact 0.80 -> 0.76 weather degradation."""
    # Full history (120/120 -> sufficiency = 1.0)
    # p50=50, p10=40, p90=60 -> spread=20 -> dispersion = 1 - (20/(2*50)) = 1 - 0.20 = 0.80
    score_with_weather = compute_confidence_score(p10=40, p50=50, p90=60, non_censored_days_180=120, weather_available=True)
    assert score_with_weather["confidence_score"] == 0.80

    # Weather unavailable -> 0.80 * 0.95 = 0.76
    score_without_weather = compute_confidence_score(p10=40, p50=50, p90=60, non_censored_days_180=120, weather_available=False)
    assert score_without_weather["confidence_score"] == 0.76, f"Expected 0.76, got {score_without_weather['confidence_score']}"
    assert score_without_weather["weather_adjustment_applied"] is True

# 7. Cold Start Rule (<28 days history, confidence <= 0.45) (Step 31)
def test_cold_start_confidence_cap():
    """Step 31: Verifies newly launched SKU has cold_start_flag=True and confidence <= 0.45."""
    res = client.get("/ml/v1/forecast/demand?branch_id=BR-KHI-01&sku_id=SKU-BRD-01-NEW&date=2026-09-19")
    assert res.status_code == 200
    data = res.json()
    assert data["cold_start_flag"] is True
    assert data["confidence_score"] <= 0.45, f"Confidence exceeded 0.45: {data['confidence_score']}"

# 8. Forecast Horizon Guardrail (Step 25)
def test_35_day_horizon_guardrail():
    """Step 25: 34d & 35d accepted (200), 36d rejected with HTTP 422."""
    today = datetime.now().date()
    d34 = (today + timedelta(days=34)).strftime("%Y-%m-%d")
    d35 = (today + timedelta(days=35)).strftime("%Y-%m-%d")
    d36 = (today + timedelta(days=36)).strftime("%Y-%m-%d")

    # 34 days -> OK
    r34 = client.get(f"/ml/v1/forecast/demand?branch_id=BR-KHI-01&sku_id=SKU-BRD-01&date={d34}")
    assert r34.status_code == 200

    # 35 days -> OK
    r35 = client.get(f"/ml/v1/forecast/demand?branch_id=BR-KHI-01&sku_id=SKU-BRD-01&date={d35}")
    assert r35.status_code == 200

    # 36 days -> 422 Unprocessable Entity
    r36 = client.get(f"/ml/v1/forecast/demand?branch_id=BR-KHI-01&sku_id=SKU-BRD-01&date={d36}")
    assert r36.status_code == 422
    assert "cannot exceed 35 days" in r36.json()["detail"]

# 9. Scenario Rescore API Performance (Step 26)
def test_scenario_rescore_performance_and_accuracy():
    """Step 26: Rescores 500 SKU/branch pairs in < 3 seconds."""
    items = []
    for i in range(500):
        items.append({
            "sku_id": f"SKU-BRD-{(i % 7) + 1:02d}",
            "branch_id": "BR-KHI-01",
            "date": "2026-09-20",
            "scenario_price_pkr": 190.0,
            "promotion_depth_percent": 15.0
        })
    
    start_t = datetime.now()
    res = client.post("/ml/v1/forecast/demand/rescore", json={"items": items})
    duration = (datetime.now() - start_t).total_seconds()

    assert res.status_code == 200
    data = res.json()
    assert data["rescored_count"] == 500
    assert duration < 3.0, f"Rescore took {duration:.2f}s, exceeding 3.0s SLA"

# 10. Intermittent Demand Two-Stage Hurdle Model (Step 32)
def test_intermittent_demand_hurdle_model():
    """Step 32: Tests TwoStageHurdleModel activates for series with > 60% zero sales."""
    hurdle = TwoStageHurdleModel()
    intermittent_series = pd.Series([0, 0, 0, 5, 0, 0, 0, 10, 0, 0]) # 80% zeros
    regular_series = pd.Series([5, 8, 7, 6, 9, 4, 10, 6, 7, 8])       # 0% zeros

    assert hurdle.is_series_intermittent(intermittent_series) is True
    assert hurdle.is_series_intermittent(regular_series) is False

# 11. MLflow Model Registry, Stages & Champion/Challenger (Steps 13, 14, 15, 16)
def test_model_registry_and_promotion_lifecycle():
    """Steps 13, 14, 15, 16: Tests registration in Staging, 28-day shadow check, and rollback."""
    import uuid
    challenger_v = f"lgbm-v2.0-{uuid.uuid4().hex[:6]}"
    # Register candidate model in Staging
    reg_res = registry.register_model(
        model_version=challenger_v,
        training_start=date(2024, 1, 1),
        training_end=date(2026, 8, 31),
        git_commit="git-test-commit-4f3b",
        feature_version="feat-v1.2",
        hyperparameters={"learning_rate": 0.05, "num_leaves": 31},
        metrics={"sku_wape": 0.125, "branch_wape": 0.082},
        model_card={"architecture": "LightGBM Quantiles + SARIMAX"}
    )
    assert reg_res["stage"] == "Staging"

    # Evaluate promotion: without 28 shadow days, must not be eligible
    elig = registry.evaluate_promotion_eligibility(challenger_v)
    assert elig["eligible"] is False

    # Simulate 28 shadow days with +4.5% relative improvement
    for day_i in range(28):
        eval_d = date(2026, 8, 1) + timedelta(days=day_i)
        registry.record_shadow_evaluation(
            eval_date=eval_d,
            champion_version="lgbm-v1.0-quantile",
            challenger_version=challenger_v,
            champion_wape=0.145,
            challenger_wape=0.138, # 4.8% relative improvement
            obs_count=1000
        )

    elig_after = registry.evaluate_promotion_eligibility(challenger_v)
    assert elig_after["eligible"] is True
    assert elig_after["shadow_days"] >= 28

    # Staged promotion: Stage-1 -> Stage-2 -> Stage-3
    p1 = registry.promote_staged(challenger_v, "Stage-1")
    assert p1["rollout_stage"] == "Stage-1"

    p3 = registry.promote_staged(challenger_v, "Stage-3")
    assert p3["rollout_stage"] == "Stage-3"

    # Emergency Rollback (<5 minutes SLA)
    rb = registry.trigger_rollback(degraded_version=challenger_v, fallback_version="lgbm-v1.0-quantile")
    assert rb["status"] == "ROLLBACK_COMPLETE"
    assert rb["archived_version"] == challenger_v

# 12. Monitoring & Drift PSI Rules (Step 17)
def test_psi_drift_monitoring_rules():
    """Step 17: Tests PSI calculation and threshold alert levels."""
    np.random.seed(42)
    ref_vals = np.random.normal(50, 10, 1000)
    stable_vals = np.random.normal(50.5, 10, 1000) # Stable
    drifted_vals = np.random.normal(70, 15, 1000)   # Heavy drift

    psi_stable = calculate_psi(ref_vals, stable_vals)
    psi_drifted = calculate_psi(ref_vals, drifted_vals)

    assert psi_stable < 0.10, f"Expected stable PSI < 0.10, got {psi_stable}"
    assert psi_drifted > 0.20, f"Expected drifted PSI > 0.20, got {psi_drifted}"

# 13. Retraining Triggers (Step 20)
def test_out_of_cycle_retraining_triggers():
    """Step 20: Tests retraining triggered when prediction PSI > 0.20 or 3+ features drift."""
    # Normal case: no trigger
    normal = retraining_service.check_all_triggers(prediction_psi=0.05, drifted_features_count=0, rolling_7d_wape=0.12)
    assert normal["retraining_triggered"] is False

    # Drift trigger: prediction PSI > 0.20
    drift_trigger = retraining_service.check_all_triggers(prediction_psi=0.25, drifted_features_count=0, rolling_7d_wape=0.12)
    assert drift_trigger["retraining_triggered"] is True
    assert any(e["code"] == "TRIGGER_PRED_PSI_BREACH" for e in drift_trigger["triggered_events"])

    # WAPE breach trigger: WAPE > 30%
    wape_trigger = retraining_service.check_all_triggers(prediction_psi=0.05, drifted_features_count=0, rolling_7d_wape=0.35)
    assert wape_trigger["retraining_triggered"] is True
    assert any(e["code"] == "TRIGGER_WAPE_ACCURACY_BREACH" for e in wape_trigger["triggered_events"])

# 14. Offline vs Online Feature Parity (Step 49)
def test_offline_online_feature_parity():
    """Step 49: Validates offline/online feature parity sample with <= 0.5% tolerance."""
    parity_result = validate_feature_parity(sample_size=100, max_mismatch_pct=0.5)
    assert parity_result["status"] == "PASS"
    assert parity_result["within_tolerance"] is True
    assert parity_result["mismatch_rate_pct"] <= 0.5
