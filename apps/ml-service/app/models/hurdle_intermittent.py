"""
BakeSuite AI-01 Intermittent Demand Module (Two-Stage Hurdle Model)
For SKU and branch combinations with > 60% zero-sales days:
Stage 1: LightGBM binary classifier predicts probability of any sale P(demand > 0).
Stage 2: Conditional quantile regressor predicts quantity given a sale.
Final P50 = P(demand > 0) * Q(demand | demand > 0).
"""
import numpy as np
import pandas as pd
import lightgbm as lgb

class TwoStageHurdleModel:
    def __init__(self):
        self.classifier = None
        self.conditional_regressor = None
        self.is_fitted = False

    def is_series_intermittent(self, demand_series: pd.Series) -> bool:
        """Determines if series has > 60% zero-sales days."""
        if len(demand_series) == 0:
            return False
        zero_ratio = (demand_series == 0).mean()
        return bool(zero_ratio > 0.60)

    def fit(self, X: pd.DataFrame, y: pd.Series):
        """Fits binary classifier on occurrence and quantile regressor on positive demand."""
        # Stage 1: Binary occurrence label
        y_binary = (y > 0).astype(int)
        
        clf_params = {
            'objective': 'binary',
            'metric': 'binary_logloss',
            'learning_rate': 0.05,
            'num_leaves': 31,
            'verbosity': -1,
            'random_state': 42
        }
        train_data_clf = lgb.Dataset(X, label=y_binary)
        self.classifier = lgb.train(clf_params, train_data_clf, num_boost_round=100)

        # Stage 2: Conditional on positive demand
        positive_mask = (y > 0)
        if positive_mask.sum() > 20:
            X_pos = X[positive_mask]
            y_pos = y[positive_mask]

            reg_params = {
                'objective': 'quantile',
                'alpha': 0.50,
                'learning_rate': 0.05,
                'num_leaves': 31,
                'verbosity': -1,
                'random_state': 42
            }
            train_data_reg = lgb.Dataset(X_pos, label=y_pos)
            self.conditional_regressor = lgb.train(reg_params, train_data_reg, num_boost_round=100)
        else:
            self.conditional_regressor = None

        self.is_fitted = True

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        """Predicts expected demand as P(sale) * Q(quantity | sale)."""
        if not self.is_fitted:
            return np.ones(len(X))

        # Probability of sale
        prob_sale = self.classifier.predict(X)

        if self.conditional_regressor is not None:
            cond_qty = self.conditional_regressor.predict(X)
            cond_qty = np.maximum(1.0, cond_qty)
        else:
            cond_qty = np.ones(len(X)) * 2.0

        p50 = prob_sale * cond_qty
        return np.maximum(0.0, np.round(p50))
