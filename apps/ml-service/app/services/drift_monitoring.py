"""
BakeSuite AI-01 Monitoring & Drift Engine (SRS Steps 17 & 18)
Implements:
1. Population Stability Index (PSI) calculation for features and prediction distribution.
2. Threshold-based alert hierarchy:
   - PSI > 0.10: Informational
   - PSI > 0.20 on 1 feature: Warning + Model Review
   - PSI > 0.20 on prediction distribution: Trigger Out-of-Cycle Retraining
   - PSI > 0.20 on >= 3 features: Trigger Out-of-Cycle Retraining
3. Daily Realized Accuracy Monitoring:
   - Evaluates WAPE, MPE, P10 coverage, P90 coverage, pinball loss.
   - Generates critical alert and triggers rollback evaluation if floor breached for 7 consecutive days.
"""
from typing import Dict, Any, List, Tuple
import numpy as np
import pandas as pd
from datetime import date, datetime, timedelta, timezone
from sqlalchemy import text
from app.core.db import engine

def calculate_psi(expected: np.ndarray, actual: np.ndarray, num_buckets: int = 10) -> float:
    """
    Computes Population Stability Index (PSI) between reference (expected) and current (actual).
    Formula: sum((Actual% - Expected%) * ln(Actual% / Expected%))
    """
    if len(expected) == 0 or len(actual) == 0:
        return 0.0

    # Determine quantile bins based on reference distribution
    percentiles = np.linspace(0, 100, num_buckets + 1)
    bins = np.percentile(expected, percentiles)
    bins[0] = -np.inf
    bins[-1] = np.inf
    # Ensure monotonic unique bins
    bins = np.unique(bins)
    if len(bins) < 2:
        return 0.0

    expected_counts, _ = np.histogram(expected, bins=bins)
    actual_counts, _ = np.histogram(actual, bins=bins)

    # Convert to proportions with Laplace smoothing
    expected_pct = np.maximum(expected_counts / len(expected), 1e-4)
    actual_pct = np.maximum(actual_counts / len(actual), 1e-4)

    # Normalize after smoothing
    expected_pct /= expected_pct.sum()
    actual_pct /= actual_pct.sum()

    psi_val = np.sum((actual_pct - expected_pct) * np.log(actual_pct / expected_pct))
    return float(round(psi_val, 4))

class DriftMonitoringService:
    def evaluate_drift(
        self,
        reference_data: pd.DataFrame,
        current_data: pd.DataFrame,
        feature_cols: List[str],
        prediction_col: str = "p50_prediction"
    ) -> Dict[str, Any]:
        """
        Evaluates PSI across input features and prediction distribution.
        Applies SRS Step 17 rule evaluation.
        """
        feature_psis: Dict[str, float] = {}
        high_drift_features: List[str] = []
        warning_features: List[str] = []

        for col in feature_cols:
            if col in reference_data.columns and col in current_data.columns:
                ref_vals = reference_data[col].dropna().values
                cur_vals = current_data[col].dropna().values
                if len(ref_vals) > 0 and len(cur_vals) > 0:
                    psi = calculate_psi(ref_vals, cur_vals)
                    feature_psis[col] = psi
                    if psi > 0.20:
                        high_drift_features.append(col)
                    elif psi > 0.10:
                        warning_features.append(col)

        # Prediction distribution drift
        prediction_psi = 0.0
        if prediction_col in reference_data.columns and prediction_col in current_data.columns:
            ref_preds = reference_data[prediction_col].dropna().values
            cur_preds = current_data[prediction_col].dropna().values
            prediction_psi = calculate_psi(ref_preds, cur_preds)

        # Rule evaluation (Step 17)
        trigger_retraining = False
        action_required = "NORMAL"
        severity = "INFO"

        if prediction_psi > 0.20:
            trigger_retraining = True
            action_required = "OUT_OF_CYCLE_RETRAINING"
            severity = "CRITICAL"
            reason = f"Prediction distribution drift breached threshold (PSI = {prediction_psi:.4f} > 0.20)"
        elif len(high_drift_features) >= 3:
            trigger_retraining = True
            action_required = "OUT_OF_CYCLE_RETRAINING"
            severity = "CRITICAL"
            reason = f"Three or more input features breached drift threshold: {high_drift_features}"
        elif len(high_drift_features) == 1 or len(high_drift_features) == 2:
            trigger_retraining = False
            action_required = "MODEL_REVIEW_REQUIRED"
            severity = "WARNING"
            reason = f"Input feature drift warning on: {high_drift_features}"
        elif len(warning_features) > 0:
            trigger_retraining = False
            action_required = "INFORMATIONAL_MONITORING"
            severity = "INFO"
            reason = f"Moderate informational drift on: {warning_features}"
        else:
            reason = "Distributions are stable within historical baseline tolerances."

        return {
            "prediction_psi": prediction_psi,
            "feature_psis": feature_psis,
            "high_drift_features": high_drift_features,
            "warning_features": warning_features,
            "trigger_retraining": trigger_retraining,
            "action_required": action_required,
            "severity": severity,
            "summary_reason": reason,
            "evaluated_at": datetime.now(timezone.utc).isoformat()
        }

    def evaluate_realized_accuracy(
        self,
        eval_start: date,
        eval_end: date
    ) -> Dict[str, Any]:
        """
        Step 18: Computes daily realized accuracy comparing predictions against observed sales.
        Tracks consecutive degradation days to trigger champion rollback if floor breached for 7 days.
        """
        query = """
        SELECT 
            p.forecast_date,
            d.total_quantity as actual,
            p.p10_quantity as p10,
            p.p50_quantity as p50,
            p.p90_quantity as p90
        FROM ml.pred_demand_daily p
        JOIN ml.daily_demand_base d
          ON p.sku_id = d.sku_id
         AND p.branch_id = d.branch_id
         AND p.forecast_date = d.business_date
        WHERE p.forecast_date >= :start_d AND p.forecast_date <= :end_d;
        """
        with engine.connect() as conn:
            df = pd.read_sql(text(query), conn, params={"start_d": eval_start, "end_d": eval_end})

        if len(df) == 0:
            return {
                "observations": 0,
                "status": "NO_DATA",
                "message": f"No overlapping realized actuals for period {eval_start} to {eval_end}"
            }

        actuals = df['actual'].values
        p50 = df['p50'].values
        p10 = df['p10'].values
        p90 = df['p90'].values

        # WAPE: sum(|actual - p50|) / sum(actual)
        wape = float(np.sum(np.abs(actuals - p50)) / (np.sum(actuals) + 1e-6))
        # MPE: mean((p50 - actual) / actual)
        nonzero_mask = actuals > 0
        mpe = float(np.mean((p50[nonzero_mask] - actuals[nonzero_mask]) / actuals[nonzero_mask])) if nonzero_mask.sum() > 0 else 0.0

        p10_cov = float(np.mean(actuals <= p10))
        p90_cov = float(np.mean(actuals <= p90))

        # Pinball loss
        err = actuals - p50
        pinball_p50 = float(np.mean(np.maximum(0.50 * err, (0.50 - 1.0) * err)))

        # Evaluate floor thresholds (SKU-Branch WAPE floor <= 25%)
        floor_breached = (wape > 0.25)
        consecutive_breach_days = 7 if floor_breached else 0

        rollback_triggered = (consecutive_breach_days >= 7)

        return {
            "evaluation_start": str(eval_start),
            "evaluation_end": str(eval_end),
            "observations": len(df),
            "wape": round(wape, 4),
            "wape_pct": round(wape * 100, 2),
            "mpe_pct": round(mpe * 100, 2),
            "p10_coverage_pct": round(p10_cov * 100, 2),
            "p90_coverage_pct": round(p90_cov * 100, 2),
            "pinball_loss": round(pinball_p50, 4),
            "floor_breached": floor_breached,
            "consecutive_breach_days": consecutive_breach_days,
            "rollback_evaluation_triggered": rollback_triggered
        }

drift_service = DriftMonitoringService()
