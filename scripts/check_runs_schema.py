import psycopg2

conn = psycopg2.connect('postgresql://postgres:@localhost:5432/bakesuite')
cur = conn.cursor()
cur.execute("""
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns 
    WHERE table_schema = 'ml' AND table_name = 'forecast_runs'
    ORDER BY ordinal_position
""")
print("ml.forecast_runs columns:")
for row in cur.fetchall():
    print(" ", row)
