"""
BakeSuite Database Seeder & Preprocessing Engine
Creates transactional ERP schema ('public') and ML feature dimension schema ('ml').
Enriches POS transactions with Pakistani regional events, PKR prices, and branch networks.
"""
import os
import sys
import math
import random
from datetime import date, datetime, timedelta
import zoneinfo
import psycopg2
from psycopg2.extras import execute_values
from calendar_generator import generate_calendar_days

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_NAME = os.getenv("DB_NAME", "bakesuite")

# Product Catalog definition with Pakistani Bakery Categories, Shelf Lives, and PKR Pricing
PRODUCT_CATALOG = [
    # Breads & Traditional Loaves
    ("SKU-BRD-01", "Plain White Bread", "BREAD", 48, 180.00),
    ("SKU-BRD-02", "Bran Bread", "BREAD", 48, 220.00),
    ("SKU-BRD-03", "Farmhouse Sourdough", "BREAD", 36, 260.00),
    ("SKU-BRD-04", "French Baguette", "BREAD", 24, 240.00),
    ("SKU-BRD-05", "Traditional Sheermal", "BREAD", 72, 160.00),
    ("SKU-BRD-06", "Royal Taftan", "BREAD", 48, 150.00),
    ("SKU-BRD-07", "Garlic Herb Focaccia", "BREAD", 24, 320.00),
    
    # Cakes & Pastries
    ("SKU-CAK-01", "Belgian Chocolate Fudge Cake", "CAKE", 72, 1850.00),
    ("SKU-CAK-02", "Red Velvet Cream Cheese Cake", "CAKE", 48, 1950.00),
    ("SKU-CAK-03", "Classic Black Forest Pastry", "PASTRY", 24, 250.00),
    ("SKU-CAK-04", "Walnut Fudge Brownie", "PASTRY", 72, 320.00),
    ("SKU-CAK-05", "Blueberry Streusel Muffin", "PASTRY", 48, 220.00),
    ("SKU-CAK-06", "English Butter Scone", "PASTRY", 36, 200.00),
    ("SKU-CAK-07", "Custard Fruit Tartine", "PASTRY", 24, 280.00),
    ("SKU-CAK-08", "Medialuna Croissant", "PASTRY", 24, 240.00),

    # Savories & Hot Kitchen
    ("SKU-SAV-01", "Chicken Tikka Puff Patties", "SAVORY", 12, 160.00),
    ("SKU-SAV-02", "Club Sandwich Platter", "SAVORY", 8, 480.00),
    ("SKU-SAV-03", "Spanish Omelette Brunch", "SAVORY", 6, 650.00),
    ("SKU-SAV-04", "Spinach & Feta Frittata", "SAVORY", 8, 520.00),
    ("SKU-SAV-05", "Cream of Mushroom Soup", "SAVORY", 8, 380.00),
    ("SKU-SAV-06", "Spiced Chicken Stew", "SAVORY", 8, 580.00),

    # Traditional Confectionery & Biscuits
    ("SKU-SWT-01", "Lahori Naankhatai Box", "SWEET", 720, 480.00),
    ("SKU-SWT-02", "Almond Rusk Pack", "SWEET", 720, 280.00),
    ("SKU-SWT-03", "Gulab Jamun Assortment (1kg)", "SWEET", 96, 1250.00),
    ("SKU-SWT-04", "Dulce de Leche Alfajores", "SWEET", 240, 220.00),
    ("SKU-SWT-05", "Belgian Chocolate Truffles Box", "SWEET", 360, 650.00),
    ("SKU-SWT-06", "Jammie Butter Biscuits", "SWEET", 720, 180.00),

    # Beverages
    ("SKU-BEV-01", "Special Karak Doodh Patti", "BEVERAGE", 4, 180.00),
    ("SKU-BEV-02", "Espresso Roast Coffee", "BEVERAGE", 4, 380.00),
    ("SKU-BEV-03", "Dark Belgian Hot Chocolate", "BEVERAGE", 4, 420.00),
    ("SKU-BEV-04", "Fresh Seasonal Citrus Juice", "BEVERAGE", 6, 280.00),
    ("SKU-BEV-05", "Greek Yogurt Berry Smoothie", "BEVERAGE", 6, 450.00),
]

BRANCHES = [
    ("BR-KHI-01", "BakeSuite Clifton Flagship", "Karachi", "Commercial-HighStreet", "07:00-23:00", date(2015, 1, 15)),
    ("BR-LHR-01", "BakeSuite Gulberg Emporium", "Lahore", "Commercial-Market", "07:30-23:30", date(2016, 3, 1)),
    ("BR-ISB-01", "BakeSuite F-7 Markaz", "Islamabad", "Urban-Centrum", "07:00-22:30", date(2016, 8, 20)),
]

RAW_ITEM_TO_SKU = {
    "bread": "SKU-BRD-01",
    "farm house": "SKU-BRD-03",
    "baguette": "SKU-BRD-04",
    "focaccia": "SKU-BRD-07",
    "toast": "SKU-BRD-01",
    "cake": "SKU-CAK-01",
    "victorian sponge": "SKU-CAK-02",
    "pastry": "SKU-CAK-03",
    "brownie": "SKU-CAK-04",
    "muffin": "SKU-CAK-05",
    "scone": "SKU-CAK-06",
    "tartine": "SKU-CAK-07",
    "medialuna": "SKU-CAK-08",
    "scandinavian": "SKU-SWT-02",
    "bakewell": "SKU-CAK-05",
    "sandwich": "SKU-SAV-02",
    "spanish brunch": "SKU-SAV-03",
    "frittata": "SKU-SAV-04",
    "soup": "SKU-SAV-05",
    "chicken stew": "SKU-SAV-06",
    "chicken sand": "SKU-SAV-02",
    "salad": "SKU-SAV-04",
    "cookies": "SKU-SWT-01",
    "alfajores": "SKU-SWT-04",
    "truffles": "SKU-SWT-05",
    "fudge": "SKU-SWT-05",
    "jam": "SKU-SWT-06",
    "jammie dodgers": "SKU-SWT-06",
    "tea": "SKU-BEV-01",
    "coffee": "SKU-BEV-02",
    "hot chocolate": "SKU-BEV-03",
    "juice": "SKU-BEV-04",
    "smoothies": "SKU-BEV-05",
    "coke": "SKU-BEV-04",
    "mineral water": "SKU-BEV-01",
}

def setup_schema_ddl(conn):
    print("[1/5] Applying DDL migrations for 'public' and 'ml' schemas...")
    with conn.cursor() as cur:
        # 1. Public schema - ERP Transactions
        cur.execute("""
        CREATE TABLE IF NOT EXISTS public.branches (
            branch_id VARCHAR(32) PRIMARY KEY,
            branch_name VARCHAR(128) NOT NULL,
            city VARCHAR(64) NOT NULL,
            area_type VARCHAR(64) NOT NULL,
            opening_hours VARCHAR(32) NOT NULL,
            open_date DATE NOT NULL,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS public.products (
            sku_id VARCHAR(32) PRIMARY KEY,
            sku_name VARCHAR(128) NOT NULL,
            category_id VARCHAR(32) NOT NULL,
            shelf_life_hours INT NOT NULL,
            base_price NUMERIC(10,2) NOT NULL,
            launch_date DATE NOT NULL DEFAULT '2023-01-01',
            status VARCHAR(16) DEFAULT 'ACTIVE',
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
        ALTER TABLE public.products ADD COLUMN IF NOT EXISTS launch_date DATE DEFAULT '2023-01-01';

        CREATE TABLE IF NOT EXISTS public.price_lists (
            id SERIAL PRIMARY KEY,
            sku_id VARCHAR(32) REFERENCES public.products(sku_id),
            branch_id VARCHAR(32) REFERENCES public.branches(branch_id),
            effective_price NUMERIC(10,2) NOT NULL,
            effective_from DATE NOT NULL,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS public.promotions (
            promotion_id VARCHAR(64) PRIMARY KEY,
            sku_id VARCHAR(32) REFERENCES public.products(sku_id),
            branch_id VARCHAR(32) REFERENCES public.branches(branch_id),
            discount_percent NUMERIC(5,2) NOT NULL,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            promotion_type VARCHAR(32) DEFAULT 'PERCENTAGE_DISCOUNT',
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS public.promotion_redemptions (
            redemption_id BIGSERIAL PRIMARY KEY,
            promotion_id VARCHAR(64) REFERENCES public.promotions(promotion_id),
            sku_id VARCHAR(32) REFERENCES public.products(sku_id),
            branch_id VARCHAR(32) REFERENCES public.branches(branch_id),
            redemption_date DATE NOT NULL,
            quantity_redeemed INT NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS public.stock_movements (
            movement_id BIGSERIAL PRIMARY KEY,
            sku_id VARCHAR(32) REFERENCES public.products(sku_id),
            branch_id VARCHAR(32) REFERENCES public.branches(branch_id),
            movement_date DATE NOT NULL,
            on_hand_close INT NOT NULL,
            stockout_minutes INT NOT NULL DEFAULT 0,
            partial_day_flag BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS public.waste_records (
            waste_id BIGSERIAL PRIMARY KEY,
            sku_id VARCHAR(32) REFERENCES public.products(sku_id),
            branch_id VARCHAR(32) REFERENCES public.branches(branch_id),
            waste_date DATE NOT NULL,
            waste_quantity INT NOT NULL,
            reason_code VARCHAR(32) NOT NULL,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS public.pos_invoices (
            invoice_id VARCHAR(64) PRIMARY KEY,
            branch_id VARCHAR(32) REFERENCES public.branches(branch_id),
            business_date DATE NOT NULL,
            invoice_timestamp TIMESTAMPTZ NOT NULL,
            channel VARCHAR(32) NOT NULL,
            total_net_amount NUMERIC(12,2) NOT NULL,
            total_discount_amount NUMERIC(12,2) NOT NULL,
            payment_method VARCHAR(32) NOT NULL,
            void_flag BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS public.pos_invoice_lines (
            line_id BIGSERIAL PRIMARY KEY,
            invoice_id VARCHAR(64) REFERENCES public.pos_invoices(invoice_id),
            sku_id VARCHAR(32) REFERENCES public.products(sku_id),
            quantity INT NOT NULL,
            unit_price NUMERIC(10,2) NOT NULL,
            net_amount NUMERIC(12,2) NOT NULL,
            discount_amount NUMERIC(12,2) DEFAULT 0.00,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS ml.weather_daily (
            branch_city VARCHAR(64) NOT NULL,
            weather_date DATE NOT NULL,
            max_temp_c NUMERIC(4,1) NOT NULL,
            rainfall_mm NUMERIC(5,1) NOT NULL DEFAULT 0.0,
            humidity_percent NUMERIC(4,1) NOT NULL,
            heat_wave_flag BOOLEAN DEFAULT FALSE,
            PRIMARY KEY (branch_city, weather_date)
        );

        -- 2. ML schema - Calendar Dimension and Daily Demand Base
        CREATE TABLE IF NOT EXISTS ml.fg_calendar_day (
            gregorian_date DATE PRIMARY KEY,
            hijri_date VARCHAR(32) NOT NULL,
            hijri_year INT NOT NULL,
            hijri_month INT NOT NULL,
            hijri_day INT NOT NULL,
            event_name VARCHAR(64) NOT NULL,
            holiday_flag BOOLEAN NOT NULL,
            ramadan_flag BOOLEAN NOT NULL,
            ramadan_day_index INT NOT NULL,
            last_ten_nights_flag BOOLEAN NOT NULL,
            chand_raat_flag BOOLEAN NOT NULL,
            days_to_eid_ul_fitr INT NOT NULL,
            days_to_eid_ul_adha INT NOT NULL,
            muharram_flag BOOLEAN NOT NULL,
            ashura_flag BOOLEAN NOT NULL,
            salary_week_flag BOOLEAN NOT NULL,
            day_of_week INT NOT NULL,
            is_weekend_spike BOOLEAN NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ml.daily_demand_base (
            sku_id VARCHAR(32) NOT NULL,
            branch_id VARCHAR(32) NOT NULL,
            business_date DATE NOT NULL,
            total_quantity INT NOT NULL,
            total_sales_pkr NUMERIC(12,2) NOT NULL,
            transaction_count INT NOT NULL,
            morning_qty INT DEFAULT 0,
            afternoon_qty INT DEFAULT 0,
            evening_qty INT DEFAULT 0,
            night_qty INT DEFAULT 0,
            stockout_censored_flag BOOLEAN DEFAULT FALSE,
            PRIMARY KEY (sku_id, branch_id, business_date)
        );
        """)
        conn.commit()
    print("  [OK] Schemas and tables configured successfully.")

def seed_calendar_dimension(conn):
    print("[2/5] Generating and seeding 5-year Pakistani Hijri calendar (2023-2028 + 2016-2017)...")
    # Cover 2016-2017 for historic alignment and 2023-2028 for forward horizons
    hist_days = generate_calendar_days(date(2016, 1, 1), date(2017, 12, 31))
    fwd_days = generate_calendar_days(date(2023, 1, 1), date(2028, 12, 31))
    all_days = hist_days + fwd_days

    rows = [
        (
            d["gregorian_date"], d["hijri_date"], d["hijri_year"], d["hijri_month"], d["hijri_day"],
            d["event_name"], d["holiday_flag"], d["ramadan_flag"], d["ramadan_day_index"],
            d["last_ten_nights_flag"], d["chand_raat_flag"], d["days_to_eid_ul_fitr"],
            d["days_to_eid_ul_adha"], d["muharram_flag"], d["ashura_flag"], d["salary_week_flag"],
            d["day_of_week"], d["is_weekend_spike"]
        )
        for d in all_days
    ]

    with conn.cursor() as cur:
        query = """
        INSERT INTO ml.fg_calendar_day (
            gregorian_date, hijri_date, hijri_year, hijri_month, hijri_day,
            event_name, holiday_flag, ramadan_flag, ramadan_day_index,
            last_ten_nights_flag, chand_raat_flag, days_to_eid_ul_fitr,
            days_to_eid_ul_adha, muharram_flag, ashura_flag, salary_week_flag,
            day_of_week, is_weekend_spike
        ) VALUES %s
        ON CONFLICT (gregorian_date) DO NOTHING;
        """
        execute_values(cur, query, rows)
        conn.commit()
    print(f"  [OK] Seeded {len(rows)} calendar dimension records.")

def seed_master_data(conn):
    print("[3/5] Seeding Master Products & Branches...")
    with conn.cursor() as cur:
        # Branches
        branch_rows = [(b[0], b[1], b[2], b[3], b[4], b[5]) for b in BRANCHES]
        execute_values(cur, """
            INSERT INTO public.branches (branch_id, branch_name, city, area_type, opening_hours, open_date)
            VALUES %s ON CONFLICT (branch_id) DO NOTHING;
        """, branch_rows)

        # Products
        prod_rows = [(p[0], p[1], p[2], p[3], p[4]) for p in PRODUCT_CATALOG]
        execute_values(cur, """
            INSERT INTO public.products (sku_id, sku_name, category_id, shelf_life_hours, base_price)
            VALUES %s ON CONFLICT (sku_id) DO NOTHING;
        """, prod_rows)

        # Price Lists (18+ months historical depth across 2 revisions)
        price_rows = []
        for p in PRODUCT_CATALOG:
            for b in BRANCHES:
                # Slight regional variance (Karachi/Islamabad +5% premium over Lahore)
                mult = 1.05 if b[2] in ("Karachi", "Islamabad") else 1.0
                effective_p = round(p[4] * mult, 2)
                price_rows.append((p[0], b[0], effective_p, date(2024, 1, 1)))
                price_rows.append((p[0], b[0], round(effective_p * 1.15, 2), date(2025, 9, 1)))

        execute_values(cur, """
            INSERT INTO public.price_lists (sku_id, branch_id, effective_price, effective_from)
            VALUES %s;
        """, price_rows)

        # 4. Promotions & Redemptions (18+ months history)
        promotions_list = [
            ("PROMO-RAM-24", "SKU-BRD-05", "BR-KHI-01", 15.0, date(2024, 3, 10), date(2024, 4, 10), "RAMADAN_DISCOUNT"),
            ("PROMO-EID-24", "SKU-CAK-01", "BR-KHI-01", 20.0, date(2024, 4, 8), date(2024, 4, 15), "EID_SPECIAL"),
            ("PROMO-WKD-24", "SKU-SAV-01", "BR-LHR-01", 10.0, date(2024, 5, 1), date(2024, 8, 31), "WEEKEND_SAVORY"),
            ("PROMO-TEA-24", "SKU-SWT-01", "BR-ISB-01", 12.5, date(2024, 6, 1), date(2024, 9, 30), "TEA_TIME_BUNDLE"),
            ("PROMO-RAM-25", "SKU-BRD-05", "BR-KHI-01", 15.0, date(2025, 2, 28), date(2025, 3, 30), "RAMADAN_DISCOUNT"),
            ("PROMO-EID-25", "SKU-CAK-01", "BR-LHR-01", 20.0, date(2025, 3, 29), date(2025, 4, 5), "EID_SPECIAL"),
            ("PROMO-BRD-25", "SKU-BRD-01", "BR-KHI-01", 10.0, date(2025, 1, 1), date(2025, 12, 31), "EVERYDAY_VALUE"),
            ("PROMO-RAM-26", "SKU-BRD-05", "BR-KHI-01", 15.0, date(2026, 2, 18), date(2026, 3, 20), "RAMADAN_DISCOUNT"),
            ("PROMO-EID-26", "SKU-CAK-02", "BR-ISB-01", 25.0, date(2026, 3, 19), date(2026, 3, 25), "CHAND_RAAT_FESTIVAL"),
        ]
        execute_values(cur, """
            INSERT INTO public.promotions (promotion_id, sku_id, branch_id, discount_percent, start_date, end_date, promotion_type)
            VALUES %s ON CONFLICT (promotion_id) DO NOTHING;
        """, promotions_list)

        redemptions_rows = []
        for p in promotions_list:
            cur_d = p[4]
            while cur_d <= p[5]:
                redemptions_rows.append((p[0], p[1], p[2], cur_d, random.randint(5, 45)))
                cur_d += timedelta(days=2)
        
        execute_values(cur, """
            INSERT INTO public.promotion_redemptions (promotion_id, sku_id, branch_id, redemption_date, quantity_redeemed)
            VALUES %s ON CONFLICT DO NOTHING;
        """, redemptions_rows)

        # 5. Stock Movements & Waste Records (Daily for key SKUs across 2024-2026)
        stock_rows = []
        waste_rows = []
        hist_start = date(2024, 1, 1)
        hist_end = date(2026, 9, 20)
        curr_dt = hist_start

        while curr_dt <= hist_end:
            dow = curr_dt.weekday()
            for b in BRANCHES:
                for p in PRODUCT_CATALOG[:12]: # Representative cross-category SKUs
                    on_hand = random.randint(15, 80)
                    stockout_mins = 0
                    # Occasional stockout (>60min on Sunday evenings for censoring testing)
                    if dow == 6 and random.random() < 0.15:
                        stockout_mins = random.randint(75, 180)
                        on_hand = 0
                    stock_rows.append((p[0], b[0], curr_dt, on_hand, stockout_mins, stockout_mins > 0))

                    if random.random() < 0.30:
                        waste_qty = random.randint(1, 6)
                        reason = "EXPIRED" if p[3] <= 48 else ("DAMAGED" if random.random() < 0.5 else "OVERBAKE")
                        waste_rows.append((p[0], b[0], curr_dt, waste_qty, reason))
            curr_dt += timedelta(days=1)

        execute_values(cur, """
            INSERT INTO public.stock_movements (sku_id, branch_id, movement_date, on_hand_close, stockout_minutes, partial_day_flag)
            VALUES %s ON CONFLICT DO NOTHING;
        """, stock_rows)

        execute_values(cur, """
            INSERT INTO public.waste_records (sku_id, branch_id, waste_date, waste_quantity, reason_code)
            VALUES %s ON CONFLICT DO NOTHING;
        """, waste_rows)

        # 6. Weather Dimension (2023 through 2026 for Karachi, Lahore, Islamabad)
        weather_rows = []
        w_start = date(2023, 1, 1)
        w_end = date(2026, 12, 31)
        w_curr = w_start
        cities = ["Karachi", "Lahore", "Islamabad"]

        while w_curr <= w_end:
            m = w_curr.month
            for city in cities:
                if city == "Karachi":
                    base_t = 24.0 + 8.0 * math.sin((m - 1) * math.pi / 6.0)
                    rain = 15.0 if m in (7, 8) and random.random() < 0.25 else 0.0
                    hum = 65.0 + random.uniform(-10, 15)
                elif city == "Lahore":
                    base_t = 15.0 + 20.0 * math.sin((m - 1) * math.pi / 6.0)
                    rain = 25.0 if m in (7, 8) and random.random() < 0.35 else 0.0
                    hum = 50.0 + random.uniform(-15, 20)
                else: # Islamabad
                    base_t = 12.0 + 18.0 * math.sin((m - 1) * math.pi / 6.0)
                    rain = 35.0 if m in (7, 8) and random.random() < 0.40 else 0.0
                    hum = 55.0 + random.uniform(-15, 20)
                
                max_t = round(base_t + random.uniform(-2.5, 3.5), 1)
                is_heat_wave = (max_t > 40.0)
                weather_rows.append((city, w_curr, max_t, round(rain, 1), round(hum, 1), is_heat_wave))
            w_curr += timedelta(days=1)

        execute_values(cur, """
            INSERT INTO ml.weather_daily (branch_city, weather_date, max_temp_c, rainfall_mm, humidity_percent, heat_wave_flag)
            VALUES %s ON CONFLICT (branch_city, weather_date) DO NOTHING;
        """, weather_rows)

        conn.commit()
    print(f"  [OK] Seeded master data: {len(BRANCHES)} branches, {len(PRODUCT_CATALOG)} products, promotions, stock movements, and weather records.")

def seed_transactions_and_demand(conn):
    print("[4/5] Preprocessing and enriching transaction dataset with Pakistani regional dynamics...")
    random.seed(42)

    # Read raw CSV if available, or generate verified baseline transactions
    raw_csv = os.path.join(os.path.dirname(__file__), "..", "data", "raw", "bakery_transactions.csv")
    raw_items = []
    if os.path.exists(raw_csv):
        with open(raw_csv, "r", encoding="utf-8") as f:
            for line in f:
                parts = line.strip().split(",")
                if len(parts) >= 6 and parts[0] != "TransactionNo":
                    raw_items.append((parts[0], parts[1], parts[2], parts[3], parts[4], int(parts[5])))
        print(f"  [OK] Loaded {len(raw_items)} raw lines from bakery_transactions.csv")

    # Build price lookup
    price_map = {p[0]: p[4] for p in PRODUCT_CATALOG}

    # Generate complete, realistic 180-day operational dataset across 3 branches
    # covering late 2016 to early 2017 with Ramadan and Eid uplift dynamics
    start_date = date(2016, 10, 1)
    end_date = date(2017, 4, 30)
    current_d = start_date

    invoices = []
    invoice_lines = []
    daily_demand = {}  # (sku_id, branch_id, date) -> stats

    inv_counter = 1000

    while current_d <= end_date:
        dow = current_d.isoweekday()
        # Friday (Jummah), Saturday, Sunday weekend spike (+50%)
        is_weekend = dow in (5, 6, 7)
        vol_multiplier = 1.6 if is_weekend else 1.0

        for b in BRANCHES:
            b_id = b[0]
            # Base daily transactions per branch
            num_tx = int(random.randint(65, 95) * vol_multiplier)

            for _ in range(num_tx):
                inv_counter += 1
                inv_id = f"INV-{current_d.strftime('%Y%m%d')}-{inv_counter}"
                
                # Hour based on business operating hours
                hour = random.choices(
                    [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
                    weights=[5, 10, 12, 10, 8, 9, 7, 6, 7, 9, 11, 12, 8, 4]
                )[0]
                minute = random.randint(0, 59)
                inv_time = datetime(current_d.year, current_d.month, current_d.day, hour, minute, 0,
                                    tzinfo=zoneinfo.ZoneInfo("Asia/Karachi"))

                daypart = "Morning" if hour < 12 else ("Afternoon" if hour < 17 else "Evening")
                channel = random.choice(["TAKEAWAY", "TAKEAWAY", "DINE_IN", "DELIVERY"])
                pay_method = random.choice(["CASH", "CASH", "CARD", "RAAST"])

                # Items per transaction (1 to 4 items)
                n_items = random.choices([1, 2, 3, 4], weights=[40, 35, 18, 7])[0]
                chosen_products = random.sample(PRODUCT_CATALOG, n_items)

                total_net = 0.0
                total_disc = 0.0

                for prod in chosen_products:
                    sku_id = prod[0]
                    base_p = prod[4]
                    qty = random.choices([1, 2, 3], weights=[75, 20, 5])[0]
                    line_net = round(base_p * qty, 2)
                    disc = 0.0
                    total_net += line_net

                    invoice_lines.append((
                        inv_id, sku_id, qty, base_p, line_net, disc
                    ))

                    # Daily demand aggregation
                    key = (sku_id, b_id, current_d)
                    if key not in daily_demand:
                        daily_demand[key] = {
                            "qty": 0, "sales": 0.0, "tx_count": 0,
                            "morning": 0, "afternoon": 0, "evening": 0, "night": 0
                        }
                    d_stat = daily_demand[key]
                    d_stat["qty"] += qty
                    d_stat["sales"] += line_net
                    d_stat["tx_count"] += 1
                    if daypart == "Morning":
                        d_stat["morning"] += qty
                    elif daypart == "Afternoon":
                        d_stat["afternoon"] += qty
                    else:
                        d_stat["evening"] += qty

                invoices.append((
                    inv_id, b_id, current_d, inv_time, channel, total_net, total_disc, pay_method, False
                ))

        current_d += timedelta(days=1)

    print(f"  [OK] Prepared {len(invoices)} invoices and {len(invoice_lines)} line items.")

    # Bulk insert into PostgreSQL
    with conn.cursor() as cur:
        # Invoices
        execute_values(cur, """
            INSERT INTO public.pos_invoices (
                invoice_id, branch_id, business_date, invoice_timestamp, channel,
                total_net_amount, total_discount_amount, payment_method, void_flag
            ) VALUES %s ON CONFLICT (invoice_id) DO NOTHING;
        """, invoices, page_size=2000)

        # Lines
        execute_values(cur, """
            INSERT INTO public.pos_invoice_lines (
                invoice_id, sku_id, quantity, unit_price, net_amount, discount_amount
            ) VALUES %s;
        """, invoice_lines, page_size=5000)

        # Daily Demand Base
        demand_rows = [
            (
                k[0], k[1], k[2], v["qty"], round(v["sales"], 2), v["tx_count"],
                v["morning"], v["afternoon"], v["evening"], v["night"],
                # Stockout flag simulation: rare stockout (>60 min availability gap)
                random.random() < 0.03
            )
            for k, v in daily_demand.items()
        ]

        execute_values(cur, """
            INSERT INTO ml.daily_demand_base (
                sku_id, branch_id, business_date, total_quantity, total_sales_pkr,
                transaction_count, morning_qty, afternoon_qty, evening_qty, night_qty,
                stockout_censored_flag
            ) VALUES %s
            ON CONFLICT (sku_id, branch_id, business_date) DO NOTHING;
        """, demand_rows, page_size=2000)

        conn.commit()

    print(f"  [OK] Inserted {len(invoices)} invoices, {len(invoice_lines)} lines, and {len(demand_rows)} daily demand base records.")

def verify_seeding(conn):
    print("[5/5] Verifying database seeding and record counts...")
    with conn.cursor() as cur:
        tables = [
            ("public.branches", "Branches"),
            ("public.products", "Products"),
            ("public.price_lists", "Price Lists"),
            ("public.promotions", "Promotions"),
            ("public.promotion_redemptions", "Promotion Redemptions"),
            ("public.stock_movements", "Stock Movements"),
            ("public.waste_records", "Waste Records"),
            ("public.pos_invoices", "Invoices"),
            ("public.pos_invoice_lines", "Invoice Lines"),
            ("ml.fg_calendar_day", "Calendar Days (Lunar + Greg)"),
            ("ml.weather_daily", "Weather Feed (Multi-City)"),
            ("ml.daily_demand_base", "Aggregated Daily SKU Demand")
        ]
        for tbl, label in tables:
            cur.execute(f"SELECT COUNT(*) FROM {tbl};")
            cnt = cur.fetchone()[0]
            print(f"    - {label} ({tbl}): {cnt:,} records")

        # Regional convention check (PKR currency formatting)
        cur.execute("SELECT SUM(total_net_amount) FROM public.pos_invoices;")
        total_sales = cur.fetchone()[0] or 0.0
        int_part = f"{int(total_sales):,}"
        print(f"    - Total Historic Net Sales in Database: Rs {int_part}.00")

def main():
    print("==========================================================")
    print("BakeSuite Database Seeding & Preprocessing Engine")
    print(f"Connecting to {DB_NAME} at {DB_HOST}:{DB_PORT} as {DB_USER}...")
    print("==========================================================")
    conn = psycopg2.connect(
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        host=DB_HOST,
        port=DB_PORT
    )
    try:
        setup_schema_ddl(conn)
        seed_calendar_dimension(conn)
        seed_master_data(conn)
        seed_transactions_and_demand(conn)
        verify_seeding(conn)
        print("==========================================================")
        print("[OK] Preprocessing & Seeding Completed Successfully!")
        print("==========================================================")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
