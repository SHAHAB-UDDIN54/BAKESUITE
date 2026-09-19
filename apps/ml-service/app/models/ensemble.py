"""
BakeSuite AI-01 Weighted P50 Ensemble Module
Implements Non-Negative Least Squares (NNLS) combination of LightGBM P50 and SARIMAX mean.
Weights are fitted per branch on validation data and constrained to sum to 1.0.
"""
from typing import Dict, Tuple
import numpy as np
from scipy.optimize import nnls

class P50WeightedEnsemble:
    def __init__(self):
        # branch_id -> (weight_lgbm, weight_sarimax)
        self.branch_weights: Dict[str, Tuple[float, float]] = {
            "BR-KHI-01": (0.75, 0.25),
            "BR-LHR-01": (0.70, 0.30),
            "BR-ISB-01": (0.80, 0.20),
            "DEFAULT": (0.75, 0.25)
        }

    def fit_weights(self, branch_id: str, y_true: np.ndarray, y_lgbm: np.ndarray, y_sarimax: np.ndarray):
        """Fits NNLS weights constrained to w1 + w2 = 1.0 and wi >= 0."""
        if len(y_true) < 20:
            return

        A = np.column_stack([y_lgbm, y_sarimax])
        weights, _ = nnls(A, y_true)
        total = weights.sum()

        if total > 0:
            w1 = float(weights[0] / total)
            w2 = float(weights[1] / total)
        else:
            w1, w2 = 0.75, 0.25

        self.branch_weights[branch_id] = (round(w1, 3), round(w2, 3))

    def predict_ensemble_p50(
        self,
        branch_id: str,
        lgbm_p50: np.ndarray,
        sarimax_mean: np.ndarray
    ) -> np.ndarray:
        """Combines predictions using fitted branch weights."""
        w_lgbm, w_sarimax = self.branch_weights.get(branch_id, self.branch_weights["DEFAULT"])
        blended = (w_lgbm * lgbm_p50) + (w_sarimax * sarimax_mean)
        return np.maximum(1, np.round(blended)).astype(int)
