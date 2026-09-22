"""
BakeSuite AI-01 Data Readiness & Coverage Validation Script (SRS Step 5)
Evaluates historical depth, temporal gaps, and coverage thresholds across all required data sources:
- Sales (POS Invoices & Lines)
- Promotions & Redemptions
- Price Lists
- Stock Movements
- Waste Records
- Calendar Dimension (ml.fg_calendar_day)
- Weather Feed (ml.weather_daily)

Produces a rigorous audit report with PASS / WARNING / FAIL determinations.
"""
import os
import sys
from datetime import date, datetime
import psycopg2
try:
    from tabulate import tabulate
except ImportError:
    tabulate = None

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_NAME = os.getenv("DB_NAME", "bakesuite")

def get_connection():
    return psycopg2.connect(
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        host=DB_HOST,
        port=DB_PORT
    )

def validate_coverage():
    print("=" * 70)
    print("BakeSuite AI-01 Data Readiness & Coverage Audit")
    print(f"Target Database: {DB_NAME} on {DB_HOST}:{DB_PORT}")
    print("=" * 70)

    conn = get_connection()
    cur = conn.cursor()

    env_mode = os.getenv("BAKESUITE_ENV", "development").lower()
    is_dev = env_mode in ("development", "dev", "test") or "--dev" in sys.argv
    sales_min_months = 6 if is_dev else 12

    checks = [
        {
            "name": "Sales Transactions (pos_invoices)",
            "query": "SELECT MIN(business_date), MAX(business_date), COUNT(DISTINCT business_date), COUNT(*) FROM public.pos_invoices;",
            "min_months": sales_min_months,
            "pref_months": 24,
            "category": "Sales"
        },
        {
            "name": "Aggregated Daily Demand (ml.daily_demand_base)",
            "query": "SELECT MIN(business_date), MAX(business_date), COUNT(DISTINCT business_date), COUNT(*) FROM ml.daily_demand_base;",
            "min_months": sales_min_months,
            "pref_months": 24,
            "category": "Demand"
        },
        {
            "name": "Promotions (public.promotions)",
            "query": """
                SELECT 
                    COALESCE(MIN(start_date), CURRENT_DATE), 
                    COALESCE(MAX(end_date), CURRENT_DATE), 
                    COALESCE(COUNT(DISTINCT start_date), 0), 
                    COUNT(*) 
                FROM public.promotions;
            """,
            "min_months": 18,
            "pref_months": 18,
            "category": "Promotions"
        },
        {
            "name": "Price Lists (public.price_lists)",
            "query": """
                SELECT 
                    COALESCE(MIN(effective_from), CURRENT_DATE), 
                    COALESCE(MAX(effective_from), CURRENT_DATE), 
                    COALESCE(COUNT(DISTINCT effective_from), 0), 
                    COUNT(*) 
                FROM public.price_lists;
            """,
            "min_months": 18,
            "pref_months": 18,
            "category": "Prices"
        },
        {
            "name": "Stock Movements (public.stock_movements)",
            "query": """
                SELECT 
                    COALESCE(MIN(movement_date), CURRENT_DATE), 
                    COALESCE(MAX(movement_date), CURRENT_DATE), 
                    COALESCE(COUNT(DISTINCT movement_date), 0), 
                    COUNT(*) 
                FROM public.stock_movements;
            """,
            "min_months": 18,
            "pref_months": 18,
            "category": "Stock"
        },
        {
            "name": "Waste Records (public.waste_records)",
            "query": """
                SELECT 
                    COALESCE(MIN(waste_date), CURRENT_DATE), 
                    COALESCE(MAX(waste_date), CURRENT_DATE), 
                    COALESCE(COUNT(DISTINCT waste_date), 0), 
                    COUNT(*) 
                FROM public.waste_records;
            """,
            "min_months": 12,
            "pref_months": 12,
            "category": "Waste"
        },
        {
            "name": "Calendar Dimension (ml.fg_calendar_day)",
            "query": """
                SELECT 
                    MIN(gregorian_date), 
                    MAX(gregorian_date), 
                    COUNT(DISTINCT gregorian_date), 
                    COUNT(*) 
                FROM ml.fg_calendar_day;
            """,
            "min_months": 60, # 36m history + 24m forward = 60 months
            "pref_months": 60,
            "category": "Calendar"
        },
        {
            "name": "Weather Feed (ml.weather_daily)",
            "query": """
                SELECT 
                    COALESCE(MIN(weather_date), CURRENT_DATE), 
                    COALESCE(MAX(weather_date), CURRENT_DATE), 
                    COALESCE(COUNT(DISTINCT weather_date), 0), 
                    COUNT(*) 
                FROM ml.weather_daily;
            """,
            "min_months": 24,
            "pref_months": 24,
            "category": "Weather"
        }
    ]

    results = []
    overall_status = "PASS"

    for c in checks:
        try:
            cur.execute(c["query"])
            row = cur.fetchone()
            min_d, max_d, distinct_days, row_count = row[0], row[1], int(row[2]), int(row[3])
            
            if min_d and max_d and row_count > 0:
                total_days = (max_d - min_d).days + 1
                months = round(total_days / 30.4375, 1)
                missing_days = max(0, total_days - distinct_days)
            else:
                total_days = 0
                months = 0.0
                missing_days = 0
                min_d = "N/A"
                max_d = "N/A"

            # Determine status
            if row_count == 0:
                status = "FAIL"
                reason = "No records found"
                if overall_status != "FAIL":
                    overall_status = "WARNING"
            elif months >= c["pref_months"] and missing_days == 0:
                status = "PASS"
                reason = f"Full coverage ({months}m >= {c['pref_months']}m)"
            elif months >= c["min_months"]:
                status = "PASS" if (is_dev and c["category"] in ("Sales", "Demand")) else "WARNING"
                reason = f"Acceptable dev baseline ({months}m >= {c['min_months']}m min, {c['pref_months']}m prod pref)" if (is_dev and c["category"] in ("Sales", "Demand")) else f"Acceptable ({months}m >= {c['min_months']}m min, {c['pref_months']}m pref)"
            else:
                status = "WARNING" if c["category"] == "Weather" else "FAIL"
                reason = f"Insufficient history ({months}m < {c['min_months']}m min)"
                if status == "FAIL":
                    overall_status = "FAIL"

            results.append({
                "source": c["name"],
                "first_date": str(min_d),
                "last_date": str(max_d),
                "days": total_days,
                "months": months,
                "missing": missing_days,
                "rows": row_count,
                "status": status,
                "reason": reason
            })
        except Exception as e:
            conn.rollback()
            results.append({
                "source": c["name"],
                "first_date": "ERR",
                "last_date": "ERR",
                "days": 0,
                "months": 0,
                "missing": 0,
                "rows": 0,
                "status": "FAIL",
                "reason": f"Table or query error: {e}"
            })
            overall_status = "FAIL"

    cur.close()
    conn.close()

    # Print Table
    header = f"{'Data Source':<36} | {'First Date':<10} | {'Last Date':<10} | {'Months':<6} | {'Rows':<8} | {'Status':<7} | {'Note'}"
    print(header)
    print("-" * len(header))
    for r in results:
        color = ""
        print(f"{r['source']:<36} | {r['first_date']:<10} | {r['last_date']:<10} | {r['months']:<6} | {r['rows']:<8} | {r['status']:<7} | {r['reason']}")

    print("=" * 70)
    print(f"OVERALL DATA READINESS STATUS: [{overall_status}]")
    print("=" * 70)
    return overall_status, results

if __name__ == "__main__":
    status, _ = validate_coverage()
    sys.exit(0 if status in ("PASS", "WARNING") else 1)
