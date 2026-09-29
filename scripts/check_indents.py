import psycopg2

conn = psycopg2.connect('postgresql://postgres:@localhost:5432/bakesuite')
cur = conn.cursor()
cur.execute("SELECT * FROM public.branch_indents WHERE sku_id = 'SKU-BRD-01' AND indent_date = '2026-09-30'")
print("Branch indents row for SKU-BRD-01 on 2026-09-30:")
for r in cur.fetchall():
    print(" ", r)

cur.execute("SELECT * FROM public.forecast_overrides WHERE sku_id = 'SKU-BRD-01' AND forecast_date = '2026-09-30'")
print("Forecast overrides row for SKU-BRD-01 on 2026-09-30:")
for r in cur.fetchall():
    print(" ", r)
