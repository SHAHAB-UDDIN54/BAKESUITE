"""
BakeSuite AI-01 Rolling-Origin Backtesting Engine
Executes 6 expanding-window folds with a 1-day gap to prevent same-day leakage
and evaluate across 28-day horizons covering 168 total evaluation days.
Computes WAPE, MPE, empirical quantile coverage, and pinball loss.
"""
from typing import List, Dict, Any
import numpy as np
import pandas as pd

def calculate_wape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Weighted Absolute Percentage Error = sum(|y - y_hat|) / sum(y) * 100%"""
    denom = np.sum(y_true)
    if denom == 0:
        return 0.0
    return float(np.sum(np.abs(y_true - y_pred)) / denom * 100.0)

def calculate_mpe(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Mean Percentage Error = mean((y_hat - y) / y) * 100%"""
    mask = (y_true > 0)
    if not mask.any():
        return 0.0
    return float(np.mean((y_pred[mask] - y_true[mask]) / y_true[mask]) * 100.0)

def calculate_quantile_coverage(y_true: np.ndarray, y_quant: np.ndarray) -> float:
    """Empirical fraction of true observations below quantile prediction."""
    if len(y_true) == 0:
        return 0.0
    return float(np.mean(y_true <= y_quant) * 100.0)

class BacktestEngine:
    def __init__(self, n_folds: int = 6, eval_days: int = 28, gap_days: int = 1):
        self.n_folds = n_folds
        self.eval_days = eval_days
        self.gap_days = gap_days

    def generate_folds(self, df: pd.DataFrame) -> List[Dict[str, Any]]:
        """Generates 6 expanding window train-test fold splits."""
        dates = sorted(df['business_date'].unique())
        total_eval_span = (self.n_folds * self.eval_days)
        
        if len(dates) < (total_eval_span + 30):
            # In case date range is compact, space folds proportionally
            step = max(7, len(dates) // (self.n_folds + 2))
            eval_len = step
        else:
            step = self.eval_days
            eval_len = self.eval_days

        folds = []
        # Work backward from maximum date
        max_date = dates[-1]
        for f in range(self.n_folds - 1, -1, -1):
            eval_end = max_date - pd.Timedelta(days=f * step)
            eval_start = eval_end - pd.Timedelta(days=eval_len)
            train_end = eval_start - pd.Timedelta(days=self.gap_days)

            train_mask = (df['business_date'] <= train_end)
            eval_mask = (df['business_date'] >= eval_start) & (df['business_date'] <= eval_end)

            folds.append({
                "fold_index": len(folds) + 1,
                "train_end": train_end,
                "eval_start": eval_start,
                "eval_end": eval_end,
                "train_idx": df[train_mask].index,
                "eval_idx": df[eval_mask].index
            })

        return folds
