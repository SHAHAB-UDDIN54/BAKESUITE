"""
BakeSuite AI-01 Unified Production Prediction Service
Shared model-serving layer ensuring that both Nightly Batch Scoring and the On-Demand Rescore API
execute the exact same production prediction pipeline:
Features -> LightGBM Tri-Quantiles -> Trained SARIMAX Baseline -> Persisted NNLS Ensemble
         -> Promotional Adjustment (Business Rule) -> 56-Day Clipping Guardrail
         -> Monotonic Quantile Ordering -> SRS Confidence Computation
"""
from typing import List, Dict, Any, Optional
import os
import numpy as np
import pandas as pd
from app.models.lgbm_quantiles import LightGBMQuantileModel
from app.models.sarimax_baseline import SarimaxBaselineModel
from app.models.ensemble import P50WeightedEnsemble
from app.models.confidence import compute_confidence_score
from config import settings

class PredictionPipelineService:
    """
    Singleton service that holds loaded model artifacts and executes
    unified inference across batch and on-demand rescore workflows.
    """
    def __init__(self, models_dir: Optional[str] = None):
        if models_dir is None:
            models_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "models"))
        self.models_dir = models_dir
        self.lgbm_model = LightGBMQuantileModel(model_dir=self.models_dir)
        self.sarimax_model = SarimaxBaselineModel(model_dir=self.models_dir)
        self.ensemble = P50WeightedEnsemble(model_dir=self.models_dir)
        self._is_loaded = False

    def load_artifacts(self):
        """Loads LightGBM quantiles, fitted SARIMAX models, and persisted NNLS ensemble weights."""
        if not self._is_loaded:
            print(f"[PredictionPipeline] Loading model artifacts from {self.models_dir}...")
            self.lgbm_model.load()
            sarimax_loaded = self.sarimax_model.load()
            ensemble_loaded = self.ensemble.load()
            print(f"[PredictionPipeline] SARIMAX artifacts loaded: {sarimax_loaded} ({len(self.sarimax_model.models)} series)")
            print(f"[PredictionPipeline] Ensemble weights loaded: {ensemble_loaded} (Learned: {self.ensemble.is_learned})")
            self._is_loaded = True

    def predict_batch(
        self,
        df_features: pd.DataFrame,
        items_meta: List[Dict[str, Any]],
        weather_available: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Executes the full production prediction pipeline on a feature matrix.
        
        Guarantees:
        1. LightGBM quantile regression (P10, P50, P90).
        2. Real trained SARIMAX linear seasonal baseline prediction.
        3. Persisted NNLS ensemble blending (LightGBM P50 + SARIMAX mean).
        4. Documented promotion elasticity business rule if promotion depth > 0.
        5. Trailing 56-day anomaly clipping (3x trailing 56d max observed).
        6. Explicit cold-start safety (no min(None, value) errors).
        7. Strict monotonic quantile ordering (P10 <= P50 <= P90).
        8. SRS confidence calculation (dispersion x sufficiency).
        """
        self.load_artifacts()

        if len(df_features) == 0:
            return []

        # 1. LightGBM Quantile Inference
        p10_lgb, p50_lgb, p90_lgb = self.lgbm_model.predict_quantiles(df_features)

        # 2. Extract exogenous feature columns for SARIMAX
        exog_cols = ['is_weekend_spike', 'ramadan_flag', 'last_ten_nights_flag', 'chand_raat_flag', 'holiday_flag']
        for col in exog_cols:
            if col not in df_features.columns:
                df_features[col] = 0

        # Group rows by (branch_id, category_id, forecast_date) to perform level-aligned category blending
        # Step 1: LightGBM P10/P50/P90 at SKU level generated above
        # Step 2: Aggregate LightGBM P50 to branch + category + date
        # Step 3: Generate SARIMAX forecast at SAME branch + category + date
        # Step 4: Combine aligned category P50 using learned weights
        # Step 5: Allocate resulting category ensemble back to SKU level using SKU model share
        # Step 6: Preserve monotonic ordering P10 <= P50 <= P90
        group_indices: Dict[tuple, List[int]] = {}
        for idx, meta in enumerate(items_meta):
            key = (meta["branch_id"], meta.get("category_id", "CAT"), meta["forecast_date"])
            if key not in group_indices:
                group_indices[key] = []
            group_indices[key].append(idx)

        # Pre-calculate category-level SARIMAX and allocate back to constituent SKUs
        sku_allocated_p50: Dict[int, float] = {}
        sku_sarimax_val: Dict[int, Optional[float]] = {}
        for (b_id, cat_id, f_date), indices in group_indices.items():
            sku_p50_dict = {items_meta[i]["sku_id"]: float(p50_lgb[i]) for i in indices}
            lgbm_cat_p50 = float(sum(sku_p50_dict.values()))

            first_idx = indices[0]
            exog_row = df_features.iloc[[first_idx]][exog_cols].astype(float).values
            sar_pred = self.sarimax_model.predict(
                branch_id=b_id,
                category_id=cat_id,
                steps=1,
                exog_future=exog_row
            )
            sar_cat_mean = float(sar_pred[0]) if (sar_pred is not None and len(sar_pred) > 0 and np.isfinite(sar_pred[0])) else None

            # Blend at Category level
            ens_cat_p50 = self.ensemble.blend_category_level(
                branch_id=b_id,
                lgbm_category_p50=lgbm_cat_p50,
                sarimax_category_mean=sar_cat_mean
            )

            # Allocate back to constituent SKUs
            allocated_map = self.ensemble.allocate_to_skus(ens_cat_p50, sku_p50_dict)
            allocated_sarimax = self.ensemble.allocate_to_skus(sar_cat_mean, sku_p50_dict) if (sar_cat_mean is not None and sar_cat_mean > 0) else {}
            for i in indices:
                s_id = items_meta[i]["sku_id"]
                sku_allocated_p50[i] = allocated_map.get(s_id, float(p50_lgb[i]))
                sku_sarimax_val[i] = allocated_sarimax.get(s_id, None)

        results = []
        for idx, meta in enumerate(items_meta):
            branch_id = meta["branch_id"]
            sku_id = meta["sku_id"]
            category_id = meta.get("category_id", "")
            f_date = meta["forecast_date"]
            base_price = float(meta.get("base_price", 100.0))
            scenario_price = float(meta.get("scenario_price", base_price))
            promo_depth = float(meta.get("promo_depth", 0.0))
            max_obs = meta.get("max_observed", 0)
            non_censored_days = meta.get("non_censored_days", 120)
            event_name = meta.get("event_context", "Normal")
            is_cold_start = bool(meta.get("is_cold_start", False))

            lgb_p10 = float(p10_lgb[idx])
            lgb_p50 = float(p50_lgb[idx])
            lgb_p90 = float(p90_lgb[idx])

            # 3. Level-aligned ensemble SKU allocation
            raw_p50 = float(sku_allocated_p50.get(idx, lgb_p50))
            raw_p10 = lgb_p10
            raw_p90 = lgb_p90
            sarimax_val = sku_sarimax_val.get(idx, None)

            # 4. Documented Promotion Business Rule Adjustment
            # Applied only if promo_depth > 0 as an explicit scenario adjustment
            if promo_depth > 0:
                promo_factor = 1.0 + (promo_depth * settings.PROMOTION_BUSINESS_RULE_ELASTICITY)
                raw_p10 *= promo_factor
                raw_p50 *= promo_factor
                raw_p90 *= promo_factor

            # 5. Anomaly Clipping Guardrail (3x trailing 56-day observed max)
            # Cold-start safe: only apply ceiling if historical maximum is strictly positive
            forecast_ceiling = int(max_obs * 3.0) if (max_obs and max_obs > 0) else None
            clipped = False
            if forecast_ceiling is not None and raw_p50 > forecast_ceiling:
                final_p50 = int(forecast_ceiling)
                clipped = True
            else:
                final_p50 = int(round(raw_p50))

            # 6. Monotonic Quantile Ordering: P10 <= P50 <= P90
            final_p10 = max(1, min(int(round(raw_p10)), final_p50))
            final_p90 = max(final_p50, int(round(raw_p90)))

            if clipped and forecast_ceiling is not None and final_p90 > int(forecast_ceiling * 1.5):
                final_p90 = int(forecast_ceiling * 1.5)

            # Strict bounds
            final_p10 = max(1, final_p10)
            final_p50 = max(final_p10, final_p50)
            final_p90 = max(final_p50, final_p90)

            # 7. SRS Confidence Score
            conf = compute_confidence_score(
                p10=final_p10,
                p50=final_p50,
                p90=final_p90,
                non_censored_days_180=non_censored_days,
                is_cold_start=is_cold_start,
                weather_available=weather_available
            )

            # 8. Feature drivers / explanation
            row_series = df_features.iloc[idx]
            drivers = self.lgbm_model.get_top_feature_contributions(row_series)
            if clipped:
                drivers.append("Capped by 56-day operational historical ceiling")
            if promo_depth > 0:
                drivers.append(f"Scenario promotion depth {promo_depth:.1f}% uplift applied")

            expected_rev = round(final_p50 * scenario_price, 2)

            weights = self.ensemble.get_weights_for_branch(branch_id)
            has_sarimax = (sarimax_val is not None and np.isfinite(sarimax_val))

            results.append({
                "sku_id": sku_id,
                "branch_id": branch_id,
                "category_id": category_id,
                "forecast_date": str(f_date),
                "p10_quantity": final_p10,
                "p50_quantity": final_p50,
                "p90_quantity": final_p90,
                "lgb_p50": round(lgb_p50, 1),
                "sarimax_p50": round(float(sarimax_val), 1) if has_sarimax else None,
                "ensemble_weights": {"lgbm": weights[0], "sarimax": weights[1]},
                "unit_of_measure": "PCS",
                "expected_revenue_pkr": expected_rev,
                "confidence_score": conf["confidence_score"],
                "confidence_band": conf["confidence_band"],
                "forecast_clipped": clipped,
                "event_context": event_name,
                "driver_summary": drivers,
                "cold_start_flag": is_cold_start,
                "served_from": "ensemble" if has_sarimax else "lgbm_fallback"
            })

        return results

# Shared global instance
prediction_service = PredictionPipelineService()
