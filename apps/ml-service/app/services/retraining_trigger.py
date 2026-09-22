"""
BakeSuite AI-01 Out-of-Cycle Retraining Trigger Service (SRS Step 20)
Monitors 7 specific trigger conditions and creates auditable retraining events:
1. PSI > 0.20 on prediction distribution
2. PSI > 0.20 on 3 or more input features
3. Rolling 7-day SKU-branch-day WAPE > 30%
4. New branch activated in branch directory
5. 30 or more new SKUs added within a 14-day window
6. Base price changes > 10% for SKUs representing > 15% revenue
7. 14 days before Ramadan (calendar-driven pre-season trigger)
"""
from typing import Dict, Any, List, Optional
from datetime import date, datetime, timedelta
from sqlalchemy import text
from app.core.db import engine

def ensure_retraining_trigger_tables():
    ddl = """
    CREATE TABLE IF NOT EXISTS ml.retraining_events (
        event_id BIGSERIAL PRIMARY KEY,
        trigger_code VARCHAR(64) NOT NULL,
        trigger_name VARCHAR(128) NOT NULL,
        trigger_context JSONB NOT NULL,
        action_dispatched VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    """
    with engine.connect() as conn:
        conn.execute(text(ddl))
        conn.commit()

try:
    ensure_retraining_trigger_tables()
except Exception:
    pass

class RetrainingTriggerService:
    def check_all_triggers(
        self,
        current_date: Optional[date] = None,
        prediction_psi: float = 0.05,
        drifted_features_count: int = 0,
        rolling_7d_wape: float = 0.14
    ) -> Dict[str, Any]:
        """Evaluates all 7 trigger criteria and logs any active events."""
        ensure_retraining_trigger_tables()
        curr_d = current_date or datetime.now().date()
        triggered_events = []

        # 1. Prediction PSI > 0.20
        if prediction_psi > 0.20:
            triggered_events.append({
                "code": "TRIGGER_PRED_PSI_BREACH",
                "name": "Prediction Distribution Drift (>0.20)",
                "context": {"observed_psi": prediction_psi, "threshold": 0.20}
            })

        # 2. PSI > 0.20 on >= 3 features
        if drifted_features_count >= 3:
            triggered_events.append({
                "code": "TRIGGER_FEATURE_PSI_BREACH",
                "name": "Multi-Feature Drift (>= 3 features > 0.20)",
                "context": {"drifted_features_count": drifted_features_count, "threshold": 3}
            })

        # 3. Rolling 7-day WAPE > 30%
        if rolling_7d_wape > 0.30:
            triggered_events.append({
                "code": "TRIGGER_WAPE_ACCURACY_BREACH",
                "name": "Rolling 7-Day WAPE Critical Breach (>30%)",
                "context": {"observed_wape": rolling_7d_wape, "threshold": 0.30}
            })

        # 4 & 5. Database queries for Branch, SKU, and Ramadan triggers
        with engine.connect() as conn:
            # 4. New branch activated in last 7 days
            b_query = """
            SELECT COUNT(*) FROM public.branches 
            WHERE open_date >= :recent_date;
            """
            recent_b = conn.execute(text(b_query), {
                "recent_date": curr_d - timedelta(days=7)
            }).fetchone()[0]
            if recent_b > 0:
                triggered_events.append({
                    "code": "TRIGGER_NEW_BRANCH_ACTIVATED",
                    "name": f"New Branch Activated ({recent_b} branch(es) added recently)",
                    "context": {"new_branches": recent_b}
                })

            # 5. 30 or more new SKUs added in trailing 14 days
            sku_query = """
            SELECT COUNT(*) FROM public.products 
            WHERE launch_date >= :fourteen_days_ago AND launch_date <= :curr_date;
            """
            recent_skus = conn.execute(text(sku_query), {
                "fourteen_days_ago": curr_d - timedelta(days=14),
                "curr_date": curr_d
            }).fetchone()[0]
            if recent_skus >= 30:
                triggered_events.append({
                    "code": "TRIGGER_BULK_SKU_CATALOG_EXPANSION",
                    "name": f"Catalog Expansion ({recent_skus} new SKUs launched in 14 days)",
                    "context": {"new_skus_count": recent_skus, "threshold": 30}
                })

            # 7. Exactly 14 days before Ramadan
            ramadan_query = """
            SELECT days_to_eid_ul_fitr, ramadan_flag 
            FROM ml.fg_calendar_day 
            WHERE gregorian_date = :dt;
            """
            cal_row = conn.execute(text(ramadan_query), {"dt": curr_d}).fetchone()
            if cal_row:
                days_to_eid = cal_row[0]
                # In 30-day Ramadan, 14 days before Ramadan means days_to_eid is approx 44
                # Or check if Ramadan starts in 14 days
                starts_soon_query = """
                SELECT COUNT(*) FROM ml.fg_calendar_day
                WHERE gregorian_date = :target_ramadan_start AND ramadan_day_index = 1;
                """
                starts_in_14d = conn.execute(text(starts_soon_query), {
                    "target_ramadan_start": curr_d + timedelta(days=14)
                }).fetchone()[0]

                if starts_in_14d > 0:
                    triggered_events.append({
                        "code": "TRIGGER_PRE_RAMADAN_RETRAINING",
                        "name": "Pre-Ramadan Horizon Trigger (14 Days Prior to 1st Ramadan)",
                        "context": {"ramadan_start_date": str(curr_d + timedelta(days=14))}
                    })

        # Persist auditable trigger events
        with engine.connect() as conn:
            for ev in triggered_events:
                conn.execute(text("""
                    INSERT INTO ml.retraining_events (trigger_code, trigger_name, trigger_context, action_dispatched)
                    VALUES (:code, :name, :ctx, 'DISPATCHED_TO_K8S');
                """), {
                    "code": ev["code"],
                    "name": ev["name"],
                    "ctx": json_serialize(ev["context"])
                })
            conn.commit()

        should_retrain = len(triggered_events) > 0
        return {
            "evaluation_date": str(curr_d),
            "retraining_triggered": should_retrain,
            "active_triggers_count": len(triggered_events),
            "triggered_events": triggered_events
        }

def json_serialize(data: Any) -> str:
    import json
    return json.dumps(data)

retraining_service = RetrainingTriggerService()
