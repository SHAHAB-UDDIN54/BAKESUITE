"""
Unit tests for Phase 11 FourWeekFallbackBaseline
Verifies prediction calculation, non-negative outputs, and pinball loss computation.
"""
import pytest
import numpy as np
import pandas as pd
from app.models.baseline_fallback import FourWeekFallbackBaseline
from app.features.feature_extractor import load_daily_demand_data, load_calendar_dimension, build_feature_matrix

def test_fallback_baseline_predictions():
    df_demand = load_daily_demand_data()
    df_cal = load_calendar_dimension()
    features = build_feature_matrix(df_demand.head(2000), df_cal)
    
    baseline = FourWeekFallbackBaseline()
    preds = baseline.predict_series(features)
    
    assert len(preds) == len(features)
    assert (preds >= 1.0).all(), "All fallback predictions should be positive and >= 1 unit"
    
    # Check pinball loss calculation
    y_true = features['demand'].values
    y_pred = preds.values
    loss = baseline.calculate_pinball_loss(y_true, y_pred, alpha=0.5)
    assert loss > 0.0, f"Expected positive pinball loss, got {loss}"
    print(f"Fallback 4-Week Moving Average Pinball Loss (alpha=0.5): {loss:.4f}")
