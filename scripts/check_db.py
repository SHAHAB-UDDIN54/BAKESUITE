import psycopg2

conn = psycopg2.connect('postgresql://postgres:@localhost:5432/bakesuite')
cur = conn.cursor()

cur.execute("""
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_schema IN ('public', 'ml') 
    ORDER BY table_schema, table_name
""")
tables = cur.fetchall()
print("Tables in public and ml schemas:")
for schema, t in tables:
    cur.execute(f"SELECT COUNT(*) FROM {schema}.{t}")
    cnt = cur.fetchone()[0]
    print(f"  {schema}.{t}: {cnt} rows")
