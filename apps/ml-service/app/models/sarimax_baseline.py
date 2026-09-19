"""
BakeSuite AI-01 SARIMAX Baseline Model
Fits weekly seasonal ARIMA with Hijri event indicators supplied as exogenous regressors
per branch and category. Provides the linear seasonal baseline for the P50 ensemble.
"""
from typing import Optional, List
import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX

class SarimaxBaselineModel:
    def __init__(self):
        self.models = {}  # (branch_id, category_id) -> fitted SARIMAXResultsWrapper
        self.exog_cols = [
            'is_weekend_spike', 'ramadan_flag', 'last_ten_nights_flag',
            'chand_raat_flag', 'holiday_flag'
        ]

    def fit_branch_category(
        self,
        df_series: pd.DataFrame,
        branch_id: str,
        category_id: str
    ):
        """Fits SARIMAX(1, 0, 1)x(1, 0, 0)_7 on aggregated category daily demand."""
        sub = df_series[
            (df_series['branch_id'] == branch_id) & 
            (df_series['category_id'] == category_id)
        ].copy()
        
        if len(sub) < 28:
            return

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
        except Exception as e:
            print(f"[SARIMAX] Warning: Fit failed for {branch_id}-{category_id}: {e}")

    def predict(
        self,
        branch_id: str,
        category_id: str,
        steps: int,
        exog_future: np.ndarray
    ) -> np.ndarray:
        """Forecasts mean demand for the forward horizon."""
        key = (branch_id, category_id)
        if key in self.models:
            try:
                res = self.models[key]
                forecast = res.forecast(steps=steps, exog=exog_future)
                return np.maximum(1.0, forecast)
            except Exception:
                pass
        
        # Heuristic fallback if SARIMAX fit unavailable
        base = 15.0
        weekend_factor = np.where(exog_future[:, 0] == 1, 1.5, 1.0)
        return np.maximum(1.0, base * weekend_factor)
