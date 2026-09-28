"""
BakeSuite AI-01 Weighted P50 Ensemble Module
Implements Non-Negative Least Squares (NNLS) combination of LightGBM P50 and SARIMAX mean.
Weights are fitted per branch on validation data and constrained to sum to 1.0.
Persists learned weights to disk for consistent production inference.
"""
from typing import Dict, Tuple, Optional, Any
import os
import json
from datetime import datetime, timezone
import numpy as np
from scipy.optimize import nnls

class P50WeightedEnsemble:
    DEFAULT_WEIGHTS = {
        "BR-KHI-01": (0.75, 0.25),
        "BR-LHR-01": (0.70, 0.30),
        "BR-ISB-01": (0.80, 0.20),
        "DEFAULT": (0.75, 0.25)
    }

    def __init__(self, model_dir: str = "models"):
        self.model_dir = model_dir
        # branch_id -> (weight_lgbm, weight_sarimax)
        self.branch_weights: Dict[str, Tuple[float, float]] = dict(self.DEFAULT_WEIGHTS)
        self.is_learned = False
        self.metadata: Dict[str, Any] = {}

    def fit_weights(self, branch_id: str, y_true: np.ndarray, y_lgbm: np.ndarray, y_sarimax: np.ndarray) -> bool:
        """Fits NNLS weights constrained to w1 + w2 = 1.0 and wi >= 0."""
        if len(y_true) < 20 or len(y_lgbm) != len(y_true) or len(y_sarimax) != len(y_true):
            return False

        # Filter out NaN/invalid values
        valid_mask = np.isfinite(y_true) & np.isfinite(y_lgbm) & np.isfinite(y_sarimax)
        if np.sum(valid_mask) < 20:
            return False

        A = np.column_stack([y_lgbm[valid_mask], y_sarimax[valid_mask]])
        weights, _ = nnls(A, y_true[valid_mask])
        total = weights.sum()

        if total > 0:
            w1 = float(weights[0] / total)
            w2 = float(weights[1] / total)
        else:
            w1, w2 = 0.75, 0.25

        self.branch_weights[branch_id] = (round(w1, 3), round(w2, 3))
        self.is_learned = True
        return True

    def save(self, model_dir: Optional[str] = None):
        """Persists learned ensemble weights and optimization metadata to disk."""
        target_dir = model_dir or self.model_dir
        os.makedirs(target_dir, exist_ok=True)
        weights_path = os.path.join(target_dir, "ensemble_weights.json")

        payload = {
            "version": "ensemble-v1.0-nnls",
            "method": "Constrained NNLS (Non-negative Least Squares, sum=1.0)",
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "is_learned": self.is_learned,
            "branch_weights": {k: list(v) for k, v in self.branch_weights.items()}
        }
        with open(weights_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        self.metadata = payload
        print(f"[ENSEMBLE] Successfully saved ensemble weights to {weights_path}")

    def load(self, model_dir: Optional[str] = None) -> bool:
        """Loads persisted ensemble weights from disk."""
        target_dir = model_dir or self.model_dir
        weights_path = os.path.join(target_dir, "ensemble_weights.json")

        if not os.path.exists(weights_path):
            return False

        try:
            with open(weights_path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            raw_weights = payload.get("branch_weights", {})
            self.branch_weights = {k: (float(v[0]), float(v[1])) for k, v in raw_weights.items()}
            self.is_learned = payload.get("is_learned", True)
            self.metadata = payload
            return True
        except Exception as e:
            print(f"[ENSEMBLE] Error loading weights from {weights_path}: {e}")
            return False

    def predict_ensemble_p50(
        self,
        branch_id: str,
        lgbm_p50: np.ndarray,
        sarimax_mean: Optional[np.ndarray]
    ) -> np.ndarray:
        """
        Combines predictions using persisted branch weights.
        If SARIMAX is None (cold start / missing history), uses LightGBM P50 directly.
        """
        if sarimax_mean is None:
            return np.maximum(1, np.round(lgbm_p50)).astype(int)

        w_lgbm, w_sarimax = self.branch_weights.get(branch_id, self.branch_weights["DEFAULT"])
        blended = (w_lgbm * lgbm_p50) + (w_sarimax * sarimax_mean)
        return np.maximum(1, np.round(blended)).astype(int)

    def get_weights_for_branch(self, branch_id: str) -> Tuple[float, float]:
        """Returns (lgbm_weight, sarimax_weight) for the specified branch or DEFAULT."""
        return self.branch_weights.get(branch_id, self.branch_weights.get("DEFAULT", (0.75, 0.25)))
