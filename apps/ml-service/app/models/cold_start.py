"""
BakeSuite AI-01 Cold-Start Forecasting Module
Implements the category profile method for new SKUs with fewer than 28 days of history.
Scales the median normalized weekday-and-event demand curve of the category by launch actuals.
Guarantees cold_start_flag = True and confidence_score <= 0.45 per AC-5.
"""
from typing import Dict, Any, List
import numpy as np
import pandas as pd
from app.models.confidence import compute_confidence_score

class CategoryProfileColdStart:
    def __init__(self):
        # Category base scale profiles (median units/day in typical Pakistani branch)
        self.category_medians = {
            "BREAD": 24.0,
            "CAKE": 14.0,
            "PASTRY": 18.0,
            "SAVORY": 20.0,
            "SWEET": 16.0,
            "BEVERAGE": 22.0
        }
        # Day of week relative weights (1=Mon ... 7=Sun) with Friday/Weekend surge
        self.dow_weights = {
            1: 0.85, 2: 0.85, 3: 0.90, 4: 0.95,
            5: 1.45, 6: 1.60, 7: 1.50
        }

    def predict_cold_start(
        self,
        sku_id: str,
        category_id: str,
        branch_id: str,
        forecast_dates: List[pd.Timestamp],
        launch_week_actual_sum: float = 0.0,
        event_flags: List[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Generates 35-day forward cold-start forecast for a newly launched SKU.
        """
        base_cat_median = self.category_medians.get(category_id, 15.0)

        # Scale factor derived from launch actuals if available
        if launch_week_actual_sum > 0:
            scale_factor = launch_week_actual_sum / (base_cat_median * 7.0)
            scale_factor = max(0.4, min(2.5, scale_factor))
        else:
            scale_factor = 1.0

        results = []
        for i, dt in enumerate(forecast_dates):
            dow = dt.dayofweek + 1
            dow_weight = self.dow_weights.get(dow, 1.0)

            # Check Islamic / event uplift
            event_mult = 1.0
            event_name = "Normal"
            if event_flags and i < len(event_flags):
                ef = event_flags[i]
                event_name = ef.get("event_name", "Normal")
                if ef.get("ramadan_flag"):
                    event_mult = 1.35 if category_id in ("BREAD", "SWEET") else 0.85
                elif ef.get("chand_raat_flag"):
                    event_mult = 2.20 if category_id in ("CAKE", "SWEET") else 1.30
                elif "Eid" in event_name:
                    event_mult = 1.80

            p50 = max(1, int(round(base_cat_median * scale_factor * dow_weight * event_mult)))
            p10 = max(1, int(round(p50 * 0.60)))
            p90 = int(round(p50 * 1.50))

            conf = compute_confidence_score(
                p10=p10,
                p50=p50,
                p90=p90,
                non_censored_days_180=7, # low history
                is_cold_start=True       # Forces cap <= 0.45 (AC-5)
            )

            results.append({
                "sku_id": sku_id,
                "branch_id": branch_id,
                "forecast_date": dt.strftime("%Y-%m-%d"),
                "p10_quantity": p10,
                "p50_quantity": p50,
                "p90_quantity": p90,
                "confidence_score": conf["confidence_score"],
                "confidence_band": conf["confidence_band"],
                "cold_start_flag": True,
                "event_context": event_name,
                "driver_summary": [
                    f"Category {category_id} profile benchmark",
                    f"Launch-week scale multiplier: {scale_factor:.2f}x",
                    f"Day-of-week consumption weight: {dow_weight:.2f}x"
                ]
            })

        return results

cold_start_model = CategoryProfileColdStart()
