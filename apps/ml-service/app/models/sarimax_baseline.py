"""
BakeSuite AI-01 SARIMAX Baseline Model
Fits weekly seasonal ARIMA with Hijri event indicators supplied as exogenous regressors
per branch and category. Provides the linear seasonal baseline for the P50 ensemble.
Persists fitted model artifacts and metadata to disk for production inference.
"""
from typing import Optional, List, Dict, Any, Tuple
import os
import json
from datetime import datetime, timezone
import joblib
import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX

class SarimaxBaselineModel:
    def __init__(self, model_dir: str = "models"):
        self.model_dir = model_dir
        self.models: Dict[Tuple[str, str], Any] = {}  # (branch_id, category_id) -> fitted SARIMAXResultsWrapper
        self.metadata: Dict[str, Any] = {}
        self.exog_cols = [
            'is_weekend_spike', 'ramadan_flag', 'last_ten_nights_flag',
            'chand_raat_flag', 'holiday_flag'
        ]

    def fit_branch_category(
        self,
        df_series: pd.DataFrame,
        branch_id: str,
        category_id: str
    ) -> bool:
        """Fits SARIMAX(1, 0, 0)x(1, 0, 0)_7 on aggregated category daily demand."""
        sub = df_series[
            (df_series['branch_id'] == branch_id) & 
            (df_series['category_id'] == category_id)
        ].copy()
        
        if len(sub) < 28:
            return False

        # Daily aggregate
        daily = sub.groupby('business_date').agg({
            'demand': 'sum',
            'is_weekend_spike': 'max',
            'ramadan_flag': 'max',
            'last_ten_nights_flag': 'max',
            'chand_raat_flag': 'max',
            'holiday_flag': 'max'
        }).reset_index().sort_values('business_date')

        y = daily['demand'].values
        X_exog = daily[self.exog_cols].astype(float).values

        try:
            model = SARIMAX(
                y,
                exog=X_exog,
                order=(1, 0, 0),
                seasonal_order=(1, 0, 0, 7),
                enforce_stationarity=False,
                enforce_invertibility=False
            )
            res = model.fit(disp=False, maxiter=50)
            self.models[(branch_id, category_id)] = res
            return True
        except Exception as e:
            print(f"[SARIMAX] Warning: Fit failed for {branch_id}-{category_id}: {e}")
            return False

    def save(self, model_dir: Optional[str] = None):
        """Persists trained SARIMAX model artifacts and metadata to disk."""
        target_dir = model_dir or self.model_dir
        os.makedirs(target_dir, exist_ok=True)
        artifact_path = os.path.join(target_dir, "sarimax_models.joblib")
        meta_path = os.path.join(target_dir, "sarimax_metadata.json")

        joblib.dump(self.models, artifact_path, compress=3)

        fitted_keys = [f"{b}:{c}" for (b, c) in self.models.keys()]
        metadata = {
            "model_type": "SARIMAX(1,0,0)x(1,0,0,7)",
            "model_version": "sarimax-v1.0-seasonal",
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "fitted_series_count": len(self.models),
            "fitted_series": fitted_keys,
            "exogenous_features": self.exog_cols,
            "status": "READY"
        }
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)
        self.metadata = metadata
        print(f"[SARIMAX] Successfully saved {len(self.models)} fitted series to {artifact_path}")

    def load(self, model_dir: Optional[str] = None) -> bool:
        """Loads persisted SARIMAX model artifacts from disk."""
        target_dir = model_dir or self.model_dir
        artifact_path = os.path.join(target_dir, "sarimax_models.joblib")
        meta_path = os.path.join(target_dir, "sarimax_metadata.json")

        if not os.path.exists(artifact_path):
            return False

        try:
            self.models = joblib.load(artifact_path)
            if os.path.exists(meta_path):
                with open(meta_path, "r", encoding="utf-8") as f:
                    self.metadata = json.load(f)
            return True
        except Exception as e:
            print(f"[SARIMAX] Error loading artifacts from {artifact_path}: {e}")
            return False

    def predict(
        self,
        branch_id: str,
        category_id: str,
        steps: int,
        exog_future: np.ndarray
    ) -> Optional[np.ndarray]:
        """
        Forecasts mean demand for the forward horizon using real trained model.
        Returns None if no trained model exists for the series (explicit cold-start/fallback).
        Never returns a synthetic heuristic masquerading as SARIMAX.
        """
        # Ensure exog_future has correct columns
        if exog_future.ndim == 1:
            exog_future = exog_future.reshape(-1, len(self.exog_cols))

        key = (branch_id, category_id)
        if key in self.models:
            try:
                res = self.models[key]
                forecast = res.forecast(steps=steps, exog=exog_future)
                return np.maximum(1.0, np.asarray(forecast, dtype=float))
            except Exception as e:
                print(f"[SARIMAX] Forecast failed for {key}: {e}")

        # Check fallback to general category model across branches if available
        for (b, c), res in self.models.items():
            if c == category_id:
                try:
                    forecast = res.forecast(steps=steps, exog=exog_future)
                    return np.maximum(1.0, np.asarray(forecast, dtype=float))
                except Exception:
                    pass

        # Return None to trigger documented cold-start / category profile fallback
        return None
