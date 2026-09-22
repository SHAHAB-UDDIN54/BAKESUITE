"""
BakeSuite AI-01 Confidence Scoring Module
Implements the Dispersion x Sufficiency confidence score formula,
confidence bands (High, Medium, Low), and auto-action production thresholds.
"""
from typing import Dict, Any, Optional

def compute_confidence_score(
    p10: float,
    p50: float,
    p90: float,
    non_censored_days_180: int,
    is_cold_start: bool = False,
    weather_available: bool = True
) -> Dict[str, Any]:
    """
    Computes confidence score in [0.00, 1.00] as:
    Dispersion Factor x Sufficiency Factor
    If weather feed is unavailable, applies a 0.95 multiplier (Step 28).
    """
    # Guard against zero or negative p50
    if p50 <= 0:
        p50 = 1.0
    
    # 1. Dispersion Factor: 1 - (P90 - P10) / (2 * P50), clipped to [0.00, 1.00]
    spread = max(0.0, p90 - p10)
    dispersion_factor = max(0.0, min(1.0, 1.0 - (spread / (2.0 * p50))))

    # 2. Sufficiency Factor: min(1.0, non_censored_days / 120)
    sufficiency_factor = min(1.0, max(0.0, non_censored_days_180 / 120.0))

    # Raw score
    raw_score = round(dispersion_factor * sufficiency_factor, 4)

    # Cold start cap: capped at 0.45 regardless of computed value (AC-5 / Step 31)
    if is_cold_start:
        base_score = min(0.45, raw_score)
        limiting_factor = "Cold-Start Launch Period (<28 days history)"
    else:
        base_score = raw_score
        if dispersion_factor < sufficiency_factor:
            limiting_factor = "High Predictive Uncertainty / Wide Quantile Spread"
        else:
            limiting_factor = "Limited Historical Observations"

    # Step 28: Weather confidence adjustment (0.95 multiplier if weather unavailable)
    if not weather_available:
        final_score = round(base_score * 0.95, 4)
        if limiting_factor is None or limiting_factor == "":
            limiting_factor = "Degraded Weather Input (Seasonal Imputation)"
    else:
        final_score = base_score

    # Display Bands:
    # High: >= 0.75 (green)
    # Medium: 0.50 to <0.75 (amber)
    # Low: < 0.50 (grey)
    if final_score >= 0.75:
        confidence_band = "High"
        auto_action_allowed = (final_score >= 0.80)
    elif final_score >= 0.50:
        confidence_band = "Medium"
        auto_action_allowed = False
    else:
        confidence_band = "Low"
        auto_action_allowed = False

    return {
        "confidence_score": final_score,
        "confidence_band": confidence_band,
        "dispersion_factor": round(dispersion_factor, 4),
        "sufficiency_factor": round(sufficiency_factor, 4),
        "weather_adjustment_applied": not weather_available,
        "auto_action_allowed": auto_action_allowed,
        "limiting_factor": limiting_factor if final_score < 0.75 else None
    }
