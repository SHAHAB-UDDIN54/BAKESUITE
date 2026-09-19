"""
Phase 11: 4-Week Moving Average Baseline & Fallback Engine
Calculates same-weekday trailing 4-occurrence average with event uplift factors.
Used as the primary non-ML benchmark and for evaluating pinball loss reduction >= 20%.
"""
import pandas as pd
import numpy as np

class FourWeekFallbackBaseline:
    def __init__(self):
        self.uplift_factors = {
            "weekend": 1.40,
            "ramadan": 1.35,
            "chand_raat": 2.20,
            "eid": 1.80,
            "normal": 1.00
        }

    def predict_series(self, df_features: pd.DataFrame) -> pd.Series:
        """
        Generates predictions using trailing 4 same-weekday mean
        adjusted by stored event uplift factor.
        """
        # Fallback uses same_weekday_mean_4 computed with strict lag
        base_pred = df_features['same_weekday_mean_4'].copy()
        
        # Apply event uplift
        multipliers = np.ones(len(df_features))
        
        # Weekend multiplier
        if 'is_weekend_spike' in df_features.columns:
            multipliers = np.where(df_features['is_weekend_spike'] == 1, 1.40, multipliers)
            
        # Ramadan multiplier
        if 'ramadan_flag' in df_features.columns:
            multipliers = np.where(df_features['ramadan_flag'] == 1, multipliers * 1.35, multipliers)
            
        # Chand Raat multiplier
        if 'chand_raat_flag' in df_features.columns:
            multipliers = np.where(df_features['chand_raat_flag'] == 1, 2.20, multipliers)

        final_pred = np.maximum(1.0, np.round(base_pred * multipliers))
        return pd.Series(final_pred, index=df_features.index)

    def calculate_pinball_loss(self, y_true: np.ndarray, y_pred: np.ndarray, alpha: float = 0.5) -> float:
        """Calculates quantile pinball loss for benchmark comparison."""
        diff = y_true - y_pred
        loss = np.maximum(alpha * diff, (alpha - 1) * diff)
        return float(np.mean(loss))
