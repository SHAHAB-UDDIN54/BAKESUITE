"""
Unit test validating that ML Service can query the enriched Islamic calendar
and daily demand base tables in PostgreSQL 'ml' schema.
"""
from sqlalchemy import text
from app.core.db import engine

def test_query_calendar_dimension():
    with engine.connect() as conn:
        res = conn.execute(text("SELECT COUNT(*), COUNT(DISTINCT event_name) FROM ml.fg_calendar_day;")).fetchone()
        count = res[0]
        distinct_events = res[1]
        assert count > 2000, f"Expected >2000 calendar days, got {count}"
        assert distinct_events >= 5, "Expected distinct event names (Ramadan, Eid, etc.)"

        # Check Ramadan and Eid records exist
        ramadan_cnt = conn.execute(text("SELECT COUNT(*) FROM ml.fg_calendar_day WHERE ramadan_flag = TRUE;")).fetchone()[0]
        assert ramadan_cnt > 0, "Expected Ramadan flagged days"

        eid_cnt = conn.execute(text("SELECT COUNT(*) FROM ml.fg_calendar_day WHERE event_name LIKE 'Eid%';")).fetchone()[0]
        assert eid_cnt > 0, "Expected Eid days"

def test_query_daily_demand_base():
    with engine.connect() as conn:
        res = conn.execute(text("SELECT COUNT(*), SUM(total_sales_pkr) FROM ml.daily_demand_base;")).fetchone()
        row_count = res[0]
        total_sales = res[1]
        assert row_count > 10000, f"Expected >10000 demand rows, got {row_count}"
        assert total_sales > 1000000.0, f"Expected >1M PKR sales, got {total_sales}"
