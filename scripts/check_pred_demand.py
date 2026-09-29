import psycopg2

conn = psycopg2.connect('postgresql://postgres:@localhost:5432/bakesuite')
cur = conn.cursor()

cur.execute("""
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'ml' AND table_name = 'pred_demand_daily'
""")
cols = [c[0] for c in cur.fetchall()]
print("Columns of ml.pred_demand_daily:", cols)

cur.execute("""
    SELECT MIN(forecast_date), MAX(forecast_date), COUNT(DISTINCT forecast_date), COUNT(DISTINCT sku_id), COUNT(DISTINCT branch_id), COUNT(*)
    FROM ml.pred_demand_daily
""")
print("Stats:", cur.fetchone())

cur.execute("""
    SELECT sku_id, branch_id, forecast_date, p10_quantity, p50_quantity, p90_quantity, confidence_score
    FROM ml.pred_demand_daily
    ORDER BY forecast_date ASC
    LIMIT 5
""")
print("Sample rows:", cur.fetchall())
