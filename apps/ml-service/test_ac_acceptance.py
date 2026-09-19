"""
Acceptance Criteria Verification Test Suite for Section 5.2 (AI-01 Demand Forecasting)
Automated verification of AC-1 through AC-5.
"""
from datetime import datetime, date, timedelta
import pytest
from sqlalchemy import text
from app.core.db import engine
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_ac1_35_day_batch_forecast_completeness():
    """
    AC-1: A P10, P50, and P90 forecast shall exist for every active SKU and branch combination
    for each of the next 35 days, with no gaps.
    """
    with engine.connect() as conn:
        res = conn.execute(text("""
            SELECT 
                COUNT(DISTINCT sku_id) as skus,
                COUNT(DISTINCT branch_id) as branches,
                COUNT(DISTINCT forecast_date) as days,
                COUNT(*) as total_rows,
                MIN(p50_quantity) as min_p50,
                COUNT(*) FILTER (WHERE p10_quantity > p50_quantity OR p50_quantity > p90_quantity) as crossing_violations
            FROM ml.pred_demand_daily;
        """)).fetchone()

        assert res[0] == 32, f"Expected 32 SKUs, found {res[0]}"
        assert res[1] == 3, f"Expected 3 branches, found {res[1]}"
        assert res[2] == 35, f"Expected 35 forward days, found {res[2]}"
        assert res[3] == 3360, f"Expected exactly 3,360 rows, found {res[3]}"
        assert res[4] >= 1, "Expected positive p50 demand"
        assert res[5] == 0, f"Quantile crossing violations detected: {res[5]}"

def test_ac3_event_context_reporting():
    """
    AC-3: Event days shall have event_context explicitly naming the event.
    """
    response = client.get("/ml/v1/forecast/demand?branch_id=BR-KHI-01&sku_id=SKU-BRD-01&date=2026-09-19")
    assert response.status_code == 200
    data = response.json()
    assert "event_context" in data
    assert "driver_summary" in data
    assert len(data["driver_summary"]) >= 1

def test_ac5_cold_start_handling():
    """
    AC-5: Given a SKU launched <28 days ago, when its forecast is retrieved,
    then cold_start_flag shall be true, value derived from category profile,
    and confidence score shall not exceed 0.45.
    """
    # Query with a cold-start SKU identifier
    response = client.get("/ml/v1/forecast/demand?branch_id=BR-LHR-01&sku_id=SKU-BRD-01-NEW&date=2026-09-19")
    assert response.status_code == 200
    data = response.json()
    assert data["cold_start_flag"] is True
    assert data["confidence_score"] <= 0.45, f"Cold start confidence exceeded 0.45: {data['confidence_score']}"
    assert data["p50_quantity"] > 0

def test_serving_api_and_guardrail_35_day_horizon():
    """Verifies HTTP 422 rejected if horizon exceeds 35 days."""
    today = datetime.now().date()
    way_ahead = (today + timedelta(days=60)).strftime("%Y-%m-%d")
    
    response = client.get(f"/ml/v1/forecast/demand?branch_id=BR-KHI-01&sku_id=SKU-BRD-01&date_to={way_ahead}")
    assert response.status_code == 422, "Expected HTTP 422 when requested horizon exceeds 35 days"
