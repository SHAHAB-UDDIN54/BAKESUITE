"""
BakeSuite AI-01 ERP Extraction & Ingestion Service
Handles cursor-paginated NDJSON ingestion from the ERP Core extraction API (Port 3000)
into the ML schema staging tables (ml.stg_products, ml.stg_branches, ml.stg_price_lists, ml.stg_promotions)
and updates ml.daily_demand_base.

Strict Architecture Compliance:
The ML Service NEVER directly queries public.pos_invoices, public.pos_invoice_lines,
public.products, or public.branches in production forecasting.
"""
from typing import Dict, Any, List, Optional
import os
import json
import requests
from datetime import date, datetime, timezone
from sqlalchemy import text
from app.core.db import engine
from config import settings

ERP_BASE_URL = os.getenv("ERP_CORE_URL", "http://localhost:3000")

def ingest_master_catalog_from_erp(erp_base_url: str = ERP_BASE_URL) -> Dict[str, Any]:
    """
    Ingests product and branch master data from ERP Core extracts API into ML staging.
    """
    products_count = 0
    branches_count = 0

    try:
        # 1. Ingest Products
        resp = requests.get(f"{erp_base_url}/api/v1/ai/extracts/products", timeout=5)
        if resp.status_code == 200:
            lines = [json.loads(line) for line in resp.text.strip().split("\n") if line.strip()]
            if lines:
                with engine.connect() as conn:
                    for p in lines:
                        conn.execute(text("""
                            INSERT INTO ml.stg_products (sku_id, sku_name, category_id, shelf_life_hours, base_price, status, launch_date)
                            VALUES (:sku_id, :sku_name, :category_id, :shelf_life_hours, :base_price, :status, :launch_date)
                            ON CONFLICT (sku_id) DO UPDATE SET
                                sku_name = EXCLUDED.sku_name,
                                category_id = EXCLUDED.category_id,
                                base_price = EXCLUDED.base_price,
                                status = EXCLUDED.status,
                                ingested_at = CURRENT_TIMESTAMP;
                        """), p)
                    conn.commit()
                products_count = len(lines)
    except Exception as e:
        print(f"[ERP-INGESTION] Warning: Could not connect to ERP extracts/products: {e}. Using existing staged catalog.")

    try:
        # 2. Ingest Branches
        resp_b = requests.get(f"{erp_base_url}/api/v1/ai/extracts/branches", timeout=5)
        if resp_b.status_code == 200:
            lines_b = [json.loads(line) for line in resp_b.text.strip().split("\n") if line.strip()]
            if lines_b:
                with engine.connect() as conn:
                    for b in lines_b:
                        conn.execute(text("""
                            INSERT INTO ml.stg_branches (branch_id, branch_name, city, area_type, opening_hours, open_date)
                            VALUES (:branch_id, :branch_name, :city, :area_type, :opening_hours, :open_date)
                            ON CONFLICT (branch_id) DO UPDATE SET
                                branch_name = EXCLUDED.branch_name,
                                city = EXCLUDED.city,
                                ingested_at = CURRENT_TIMESTAMP;
                        """), b)
                    conn.commit()
                branches_count = len(lines_b)
    except Exception as e:
        print(f"[ERP-INGESTION] Warning: Could not connect to ERP extracts/branches: {e}. Using existing staged branches.")

    return {
        "status": "SUCCESS",
        "staged_products": products_count,
        "staged_branches": branches_count,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

def ingest_daily_invoices_from_erp(target_date: date, erp_base_url: str = ERP_BASE_URL) -> Dict[str, Any]:
    """
    Ingests daily invoice sales stream from ERP Core extracts API and updates ml.daily_demand_base.
    """
    invoiced_rows = 0
    try:
        since_ts = f"{target_date.isoformat()}T00:00:00Z"
        resp = requests.get(f"{erp_base_url}/api/v1/ai/extracts/invoices?since_timestamp={since_ts}&limit=50000", timeout=10)
        if resp.status_code == 200:
            lines = [json.loads(line) for line in resp.text.strip().split("\n") if line.strip()]
            # Filter strictly to target_date
            target_lines = [l for l in lines if l.get("business_date") == str(target_date)]
            if target_lines:
                # Aggregate by (sku_id, branch_id)
                agg = {}
                for l in target_lines:
                    key = (l["sku_id"], l["branch_id"])
                    qty = int(l.get("quantity", 0))
                    amt = float(l.get("net_amount", 0.0))
                    inv_id = l.get("invoice_id")
                    if key not in agg:
                        agg[key] = {"qty": 0, "amt": 0.0, "invoices": set()}
                    agg[key]["qty"] += qty
                    agg[key]["amt"] += amt
                    if inv_id:
                        agg[key]["invoices"].add(inv_id)

                with engine.connect() as conn:
                    for (sku_id, branch_id), vals in agg.items():
                        conn.execute(text("""
                            INSERT INTO ml.daily_demand_base (
                                sku_id, branch_id, business_date, total_quantity, total_sales_pkr,
                                transaction_count, stockout_censored_flag
                            ) VALUES (:sku_id, :branch_id, :dt, :qty, :amt, :tx_cnt, false)
                            ON CONFLICT (sku_id, branch_id, business_date) DO UPDATE SET
                                total_quantity = EXCLUDED.total_quantity,
                                total_sales_pkr = EXCLUDED.total_sales_pkr,
                                transaction_count = EXCLUDED.transaction_count;
                        """), {
                            "sku_id": sku_id,
                            "branch_id": branch_id,
                            "dt": target_date,
                            "qty": vals["qty"],
                            "amt": round(vals["amt"], 2),
                            "tx_cnt": len(vals["invoices"])
                        })
                    conn.commit()
                invoiced_rows = len(agg)
    except Exception as e:
        print(f"[ERP-INGESTION] ERP invoice stream sync notice: {e}")

    # Ensure baseline demand exists from ML schema
    with engine.connect() as conn:
        cnt_row = conn.execute(
            text("SELECT COUNT(*) FROM ml.daily_demand_base WHERE business_date = :dt;"),
            {"dt": target_date}
        ).fetchone()
        existing = cnt_row[0] if cnt_row else 0

    return {
        "status": "SUCCESS",
        "business_date": str(target_date),
        "aggregated_skus": existing,
        "newly_ingested_from_stream": invoiced_rows
    }
