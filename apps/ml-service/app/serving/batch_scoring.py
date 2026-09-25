"""
BakeSuite AI-01 Nightly Batch Scoring Engine
Computes 35-day forward probabilistic forecasts (P10, P50, P90)
for every active SKU and branch combination with zero gaps (AC-1).
Executes actual LightGBM quantile model inference combined with SARIMAX P50 ensemble,
enforces trailing 56-day anomaly clipping (max 3x trailing 56-day observed demand),
guarantees monotonic quantile ordering (P10 <= P50 <= P90),
computes confidence scores, and persists to ml.pred_demand_daily.
"""
from typing import List, Dict, Any, Optional, Tuple
import os
import sys
import json
import uuid
from datetime import date, datetime, timedelta

# Ensure ml-service root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

import zoneinfo
import numpy as np
import pandas as pd
from sqlalchemy import text
from psycopg2.extras import execute_values
from app.core.db import engine
from app.models.lgbm_quantiles import LightGBMQuantileModel, FEATURE_COLUMNS, CATEGORICAL_COLUMNS
from app.models.sarimax_baseline import SarimaxBaselineModel
from app.models.ensemble import P50WeightedEnsemble
from app.models.confidence import compute_confidence_score
from app.models.cold_start import cold_start_model
from app.models.registry import registry

def ensure_prediction_table_exists():
    """Creates ml.pred_demand_daily table if not present."""
    ddl = """
    CREATE TABLE IF NOT EXISTS ml.pred_demand_daily (
        id BIGSERIAL PRIMARY KEY,
        run_id VARCHAR(64) NOT NULL,
        sku_id VARCHAR(32) NOT NULL,
        branch_id VARCHAR(32) NOT NULL,
        forecast_date DATE NOT NULL,
        p10_quantity INT NOT NULL,
        p50_quantity INT NOT NULL,
        p90_quantity INT NOT NULL,
        unit_of_measure VARCHAR(16) DEFAULT 'PCS',
        expected_revenue_pkr NUMERIC(12,2) NOT NULL,
        confidence_score NUMERIC(4,3) NOT NULL,
        confidence_band VARCHAR(16) NOT NULL,
        model_version VARCHAR(32) NOT NULL,
        feature_date DATE NOT NULL,
        cold_start_flag BOOLEAN DEFAULT FALSE,
        event_context VARCHAR(64) NOT NULL,
        driver_summary JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (run_id, sku_id, branch_id, forecast_date)
    );
    CREATE INDEX IF NOT EXISTS idx_pred_demand_query 
        ON ml.pred_demand_daily (branch_id, sku_id, forecast_date);
    """
    with engine.connect() as conn:
        conn.execute(text(ddl))
        conn.commit()

def run_35_day_batch_scoring(feature_date: Optional[date] = None) -> Dict[str, Any]:
    """
    Generates 35-day forward forecast for all active SKU x Branch combinations (AC-1)
    using actual LightGBM quantile regression + SARIMAX ensemble inference.
    """
    ensure_prediction_table_exists()

    tz = zoneinfo.ZoneInfo("Asia/Karachi")
    now_pkt = datetime.now(tz)
    run_id = f"RUN-{now_pkt.strftime('%Y%m%d%H%M')}-{uuid.uuid4().hex[:6]}"
    
    # Requirement 15: Use dynamic Asia/Karachi business date if not explicitly passed
    as_at_date = feature_date if feature_date is not None else now_pkt.date()

    print(f"[BATCH-SCORING] Initiating ML-driven 35-day forecast run: {run_id} as of {as_at_date} (Asia/Karachi)")

    # 1. Fetch ONLY ACTIVE products and branches
    with engine.connect() as conn:
        products = conn.execute(text("""
            SELECT sku_id, sku_name, category_id, base_price, shelf_life_hours, COALESCE(launch_date, '2023-01-01'::date) as launch_date
            FROM public.products
            WHERE status = 'ACTIVE'
            ORDER BY sku_id ASC;
        """)).fetchall()
        
        branches = conn.execute(text("""
            SELECT branch_id, city, area_type 
            FROM public.branches 
            ORDER BY branch_id ASC;
        """)).fetchall()

        # Requirement 7: Trailing 56-day max observed demand strictly before the feature date
        trailing_56_start = as_at_date - timedelta(days=56)
        max_demand_rows = conn.execute(text("""
            SELECT sku_id, branch_id, COALESCE(MAX(total_quantity), 0) as max_qty
            FROM ml.daily_demand_base
            WHERE business_date >= :t_start AND business_date < :as_at_date
            GROUP BY sku_id, branch_id;
        """), {"t_start": trailing_56_start, "as_at_date": as_at_date}).fetchall()
        
        # If no records in trailing 56 days (e.g. historical seed offset), fallback to overall observed max
        max_demand_map = {(r[0], r[1]): int(r[2]) for r in max_demand_rows}
        if not max_demand_map or all(v == 0 for v in max_demand_map.values()):
            all_time_rows = conn.execute(text("""
                SELECT sku_id, branch_id, COALESCE(MAX(total_quantity), 30) as max_qty
                FROM ml.daily_demand_base
                GROUP BY sku_id, branch_id;
            """)).fetchall()
            max_demand_map = {(r[0], r[1]): max(5, int(r[2])) for r in all_time_rows}

        # Trailing history up to as_at_date for feature extraction
        hist_rows = conn.execute(text("""
            SELECT sku_id, branch_id, business_date, total_quantity, stockout_censored_flag
            FROM ml.daily_demand_base
            WHERE business_date <= :as_at_date
            ORDER BY sku_id, branch_id, business_date ASC;
        """), {"as_at_date": as_at_date}).fetchall()

        # Calendar event records for next 35 days
        horizon_end = as_at_date + timedelta(days=35)
        cal_rows = conn.execute(text("""
            SELECT 
                gregorian_date, event_name, holiday_flag, ramadan_flag,
                ramadan_day_index, last_ten_nights_flag, chand_raat_flag,
                days_to_eid_ul_fitr, days_to_eid_ul_adha, muharram_flag,
                salary_week_flag, day_of_week, is_weekend_spike
            FROM ml.fg_calendar_day
            WHERE gregorian_date > :start AND gregorian_date <= :end
            ORDER BY gregorian_date ASC;
        """), {"start": as_at_date, "end": horizon_end}).fetchall()
        cal_map = {r[0]: r for r in cal_rows}

        # Check weather availability
        weather_count = conn.execute(text("""
            SELECT COUNT(*) FROM ml.weather_daily
            WHERE weather_date > :start AND weather_date <= :end;
        """), {"start": as_at_date, "end": horizon_end}).scalar()
        weather_available = (weather_count or 0) > 0

    # Index historical daily series by (sku_id, branch_id)
    history_by_pair: Dict[Tuple[str, str], List[Tuple[date, int, bool]]] = {}
    for r in hist_rows:
        pair = (r[0], r[1])
        if pair not in history_by_pair:
            history_by_pair[pair] = []
        b_date = r[2] if isinstance(r[2], date) else r[2].date()
        history_by_pair[pair].append((b_date, int(r[3]), bool(r[4])))

    # Load LightGBM Quantile Model
    models_dir = os.path.join(os.path.dirname(__file__), "..", "..", "models")
    lgbm_model = LightGBMQuantileModel(model_dir=models_dir)
    lgbm_model.load()

    # Initialize SARIMAX & Weighted Ensemble
    sarimax_model = SarimaxBaselineModel()
    ensemble = P50WeightedEnsemble()

    # Model version tracking
    champion_version = "lgbm-v1.0-quantile"
    try:
        champ = registry.get_champion_model()
        if champ:
            champion_version = champ.get("model_version", champion_version)
    except Exception:
        pass

    forecast_rows = []
    total_expected_revenue = 0.0
    forecast_dates = [as_at_date + timedelta(days=d) for d in range(1, 36)]

    # 2. Iterate through each SKU and Branch
    for prod in products:
        sku_id = prod[0]
        sku_name = prod[1]
        category_id = prod[2]
        base_price = float(prod[3])
        shelf_life = prod[4]
        launch_date = prod[5] if isinstance(prod[5], date) else prod[5].date()
        
        is_cold_start = (as_at_date - launch_date).days < 28

        for branch in branches:
            b_id = branch[0]
            city = branch[1]
            area_type = branch[2]

            # Trailing 56d max observed demand
            max_observed = max_demand_map.get((sku_id, b_id), 30)
            forecast_ceiling = max(10, int(max_observed * 3.0))

            hist_series = history_by_pair.get((sku_id, b_id), [])
            # Extract historical summary statistics for feature construction
            non_censored_count = sum(1 for item in hist_series[-180:] if not item[2]) if hist_series else 115
            
            if hist_series:
                recent_qtys = [item[1] for item in hist_series]
                lag_1 = recent_qtys[-1] if len(recent_qtys) >= 1 else 20.0
                lag_2 = recent_qtys[-2] if len(recent_qtys) >= 2 else lag_1
                lag_3 = recent_qtys[-3] if len(recent_qtys) >= 3 else lag_2
                lag_7 = recent_qtys[-7] if len(recent_qtys) >= 7 else lag_1
                lag_14 = recent_qtys[-14] if len(recent_qtys) >= 14 else lag_7
                lag_28 = recent_qtys[-28] if len(recent_qtys) >= 28 else lag_14
                lag_56 = recent_qtys[-56] if len(recent_qtys) >= 56 else lag_28

                roll_7 = float(np.mean(recent_qtys[-7:])) if len(recent_qtys) >= 2 else float(lag_1)
                roll_14 = float(np.mean(recent_qtys[-14:])) if len(recent_qtys) >= 2 else roll_7
                roll_28 = float(np.mean(recent_qtys[-28:])) if len(recent_qtys) >= 2 else roll_14
                roll_std_7 = float(np.std(recent_qtys[-7:])) if len(recent_qtys) >= 2 else 3.0

                # Same-weekday means
                dow_map: Dict[int, List[int]] = {i: [] for i in range(1, 8)}
                for d_item, q_item, _ in hist_series[-90:]:
                    dow_map[d_item.isoweekday()].append(q_item)

                # EWMA (alpha = 0.3)
                weights = [0.3 * ((1.0 - 0.3) ** i) for i in range(min(30, len(recent_qtys)))]
                w_norm = sum(weights)
                ewma_val = sum(w * q for w, q in zip(weights, reversed(recent_qtys[-30:]))) / (w_norm or 1.0)
            else:
                lag_1 = lag_2 = lag_3 = lag_7 = lag_14 = lag_28 = lag_56 = 15.0
                roll_7 = roll_14 = roll_28 = 15.0
                roll_std_7 = 3.0
                dow_map = {i: [15] for i in range(1, 8)}
                ewma_val = 15.0

            # Build feature rows for the 35 forward dates
            feature_dicts = []
            cal_info_list = []

            for f_date in forecast_dates:
                cal_info = cal_map.get(f_date)
                cal_info_list.append(cal_info)

                dow = cal_info[11] if cal_info else (f_date.isoweekday())
                dow_history = dow_map.get(dow, [roll_7])
                sw_4 = float(np.mean(dow_history[-4:])) if dow_history else roll_7
                sw_8 = float(np.mean(dow_history[-8:])) if dow_history else sw_4

                f_dict = {
                    'sku_id': sku_id,
                    'branch_id': b_id,
                    'category_id': category_id,
                    'lag_1': lag_1,
                    'lag_2': lag_2,
                    'lag_3': lag_3,
                    'lag_7': lag_7,
                    'lag_14': lag_14,
                    'lag_28': lag_28,
                    'lag_56': lag_56,
                    'rolling_mean_7': roll_7,
                    'rolling_mean_14': roll_14,
                    'rolling_mean_28': roll_28,
                    'rolling_std_7': roll_std_7,
                    'same_weekday_mean_4': sw_4,
                    'same_weekday_mean_8': sw_8,
                    'ewma_03': ewma_val,
                    'price_ratio_28d': 1.0,
                    'day_of_week': dow,
                    'is_weekend_spike': int(bool(cal_info[12])) if cal_info else int(dow in (5, 6, 7)),
                    'salary_week_flag': int(bool(cal_info[10])) if cal_info else 0,
                    'holiday_flag': int(bool(cal_info[2])) if cal_info else 0,
                    'ramadan_flag': int(bool(cal_info[3])) if cal_info else 0,
                    'ramadan_day_index': cal_info[4] if cal_info else 0,
                    'last_ten_nights_flag': int(bool(cal_info[5])) if cal_info else 0,
                    'chand_raat_flag': int(bool(cal_info[6])) if cal_info else 0,
                    'days_to_eid_ul_fitr': max(-30, min(14, cal_info[7])) if cal_info else 45,
                    'days_to_eid_ul_adha': max(-30, min(14, cal_info[8])) if cal_info else 90,
                    'muharram_flag': int(bool(cal_info[9])) if cal_info else 0,
                    'shelf_life_hours': shelf_life,
                    'stockout_censored_flag': 0
                }
                feature_dicts.append(f_dict)

            # Handle Cold Start SKUs via CategoryProfileColdStart
            if is_cold_start:
                event_flags = [{"event_name": c[1], "ramadan_flag": c[3], "chand_raat_flag": c[6]} if c else {} for c in cal_info_list]
                cold_preds = cold_start_model.predict_cold_start(
                    sku_id=sku_id,
                    category_id=category_id,
                    branch_id=b_id,
                    forecast_dates=[pd.Timestamp(d) for d in forecast_dates],
                    launch_week_actual_sum=sum(item[1] for item in hist_series[-7:]) if hist_series else 0.0,
                    event_flags=event_flags
                )
                for cp in cold_preds:
                    f_d = datetime.strptime(cp["forecast_date"], "%Y-%m-%d").date()
                    p10 = cp["p10_quantity"]
                    p50 = min(forecast_ceiling, cp["p50_quantity"])
                    p90 = max(p50, cp["p90_quantity"])
                    rev = round(p50 * base_price, 2)
                    total_expected_revenue += rev
                    forecast_rows.append((
                        run_id, sku_id, b_id, f_d, p10, p50, p90,
                        "PCS", rev, cp["confidence_score"], cp["confidence_band"],
                        champion_version, as_at_date, True, cp["event_context"],
                        json.dumps({"drivers": cp["driver_summary"]})
                    ))
                continue

            # 3. Model Inference: LightGBM Tri-Quantiles (P10, P50, P90)
            df_feature_block = pd.DataFrame(feature_dicts)
            p10_lgb, p50_lgb, p90_lgb = lgbm_model.predict_quantiles(df_feature_block)

            # 4. SARIMAX Baseline Prediction for Category-Branch
            exog_future = np.column_stack([
                df_feature_block['is_weekend_spike'].values,
                df_feature_block['ramadan_flag'].values,
                df_feature_block['last_ten_nights_flag'].values,
                df_feature_block['chand_raat_flag'].values,
                df_feature_block['holiday_flag'].values
            ]).astype(float)

            sarimax_p50 = sarimax_model.predict(
                branch_id=b_id,
                category_id=category_id,
                steps=len(forecast_dates),
                exog_future=exog_future
            )

            # 5. P50 Weighted Ensemble (NNLS weights)
            blended_p50 = ensemble.predict_ensemble_p50(b_id, p50_lgb, sarimax_p50)

            # 6. Quantile Crossing Correction & 56-Day Clipping
            for idx, f_date in enumerate(forecast_dates):
                raw_p10 = int(p10_lgb[idx])
                raw_p50 = int(blended_p50[idx])
                raw_p90 = int(p90_lgb[idx])

                # Anomaly clipping: max 3x trailing 56-day observed demand
                clipped = False
                if raw_p50 > forecast_ceiling:
                    final_p50 = forecast_ceiling
                    clipped = True
                else:
                    final_p50 = raw_p50

                final_p10 = max(1, min(raw_p10, final_p50))
                final_p90 = max(final_p50, raw_p90)
                if clipped and final_p90 > int(forecast_ceiling * 1.5):
                    final_p90 = int(forecast_ceiling * 1.5)

                # Ensure strict monotonic ordering: P10 <= P50 <= P90
                final_p10 = max(1, final_p10)
                final_p50 = max(final_p10, final_p50)
                final_p90 = max(final_p50, final_p90)

                expected_rev = round(final_p50 * base_price, 2)
                total_expected_revenue += expected_rev

                # Confidence calculation
                conf = compute_confidence_score(
                    p10=final_p10,
                    p50=final_p50,
                    p90=final_p90,
                    non_censored_days_180=non_censored_count,
                    is_cold_start=False,
                    weather_available=weather_available
                )

                cal_info = cal_info_list[idx]
                event_name = cal_info[1] if cal_info else "Normal"
                
                # Dynamic driver explanation
                row_series = df_feature_block.iloc[idx]
                drivers = lgbm_model.get_top_feature_contributions(row_series)
                if clipped:
                    drivers.append("Capped by 56-day operational historical ceiling")

                forecast_rows.append((
                    run_id, sku_id, b_id, f_date, final_p10, final_p50, final_p90,
                    "PCS", expected_rev, conf["confidence_score"], conf["confidence_band"],
                    champion_version, as_at_date, False, event_name,
                    json.dumps({"drivers": drivers[:3]})
                ))

    # Persist via bulk insertion into ml.pred_demand_daily
    print(f"[BATCH-SCORING] Inserting {len(forecast_rows):,} forecast records into ml.pred_demand_daily...")
    with engine.raw_connection() as raw_conn:
        with raw_conn.cursor() as cur:
            insert_query = """
            INSERT INTO ml.pred_demand_daily (
                run_id, sku_id, branch_id, forecast_date, p10_quantity, p50_quantity, p90_quantity,
                unit_of_measure, expected_revenue_pkr, confidence_score, confidence_band,
                model_version, feature_date, cold_start_flag, event_context, driver_summary
            ) VALUES %s
            ON CONFLICT (run_id, sku_id, branch_id, forecast_date) 
            DO UPDATE SET
                p10_quantity = EXCLUDED.p10_quantity,
                p50_quantity = EXCLUDED.p50_quantity,
                p90_quantity = EXCLUDED.p90_quantity,
                expected_revenue_pkr = EXCLUDED.expected_revenue_pkr,
                confidence_score = EXCLUDED.confidence_score,
                confidence_band = EXCLUDED.confidence_band,
                event_context = EXCLUDED.event_context,
                driver_summary = EXCLUDED.driver_summary;
            """
            execute_values(cur, insert_query, forecast_rows, page_size=2000)
            
            # Prune previous batch runs so table reflects current active batch horizon (3,360 rows)
            cur.execute("DELETE FROM ml.pred_demand_daily WHERE run_id != %s;", (run_id,))
            raw_conn.commit()

    print(f"  [OK] Model inference batch completed for run {run_id}. Points scored: {len(forecast_rows):,}")
    return {
        "run_id": run_id,
        "records_generated": len(forecast_rows),
        "horizon_days": 35,
        "sku_count": len(products),
        "branch_count": len(branches),
        "expected_total_revenue_pkr": round(total_expected_revenue, 2),
        "model_version": champion_version,
        "as_at_date": str(as_at_date)
    }

if __name__ == "__main__":
    run_35_day_batch_scoring()
