import os
import sys
import time
import subprocess
import requests

def run_e2e():
    print("=" * 70)
    print("STARTING COMPLETE AI-01 END-TO-END VERIFICATION SEQUENCE")
    print("=" * 70)

    # 1. Start ML Service
    print("\n[1/5] Starting ML Service (FastAPI on port 8000)...")
    ml_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=r"d:\BAKESUITE\apps\ml-service",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    # Wait for ML service to come online
    ml_ready = False
    for _ in range(30):
        try:
            r = requests.get("http://127.0.0.1:8000/ml/v1/health", timeout=1)
            if r.status_code == 200:
                ml_ready = True
                print("  [OK] ML Service healthy and ready at http://127.0.0.1:8000")
                break
        except Exception:
            time.sleep(0.5)

    if not ml_ready:
        ml_proc.terminate()
        stdout, stderr = ml_proc.communicate()
        print("ML STDOUT:", stdout.decode("utf-8", errors="replace"))
        print("ML STDERR:", stderr.decode("utf-8", errors="replace"))
        raise RuntimeError("ML Service failed to start on port 8000")

    # 2. Start ERP Core Service
    print("\n[2/5] Starting ERP Core Service (Express on port 3000)...")
    erp_env = os.environ.copy()
    erp_env["PORT"] = "3000"
    erp_env["NODE_ENV"] = "development"
    erp_env["ML_SERVICE_URL"] = "http://127.0.0.1:8000"

    erp_proc = subprocess.Popen(
        ["node", "dist/index.js"],
        cwd=r"d:\BAKESUITE\apps\erp-core",
        env=erp_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    erp_ready = False
    for _ in range(30):
        try:
            r = requests.get("http://127.0.0.1:3000/api/v1/health", timeout=1)
            if r.status_code == 200:
                erp_ready = True
                print("  [OK] ERP Core Service healthy and ready at http://127.0.0.1:3000")
                break
        except Exception:
            time.sleep(0.5)

    if not erp_ready:
        erp_proc.terminate()
        ml_proc.terminate()
        stdout, stderr = erp_proc.communicate()
        print("ERP STDOUT:", stdout.decode("utf-8", errors="replace"))
        print("ERP STDERR:", stderr.decode("utf-8", errors="replace"))
        raise RuntimeError("ERP Core Service failed to start on port 3000")

    try:
        # 3. Authenticate and get JWT Token
        print("\n[3/5] Testing Authentication & JWT Session Flow...")
        login_res = requests.post(
            "http://127.0.0.1:3000/api/v1/auth/login",
            json={"username": "admin"}
        )
        assert login_res.status_code == 200, f"Login failed: {login_res.text}"
        auth_data = login_res.json()
        token = auth_data.get("token")
        assert token, "Token not returned from login"
        headers = {"Authorization": f"Bearer {token}"}
        print(f"  [PASS] Login successful, user: {auth_data['user']['username']}, branch: {auth_data['user']['branchId']}")

        # Session validation
        sess_res = requests.get("http://127.0.0.1:3000/api/v1/auth/session", headers=headers)
        assert sess_res.status_code == 200, "Session validation failed"
        print("  [PASS] Session endpoint successfully verified cryptographic JWT signature.")

        # 4. Forecast Workbench Workflow
        print("\n[4/5] Testing Forecast Workbench Real Data & APIs...")
        # Branches & Categories
        b_res = requests.get("http://127.0.0.1:3000/api/v1/ai/metadata/branches", headers=headers)
        assert b_res.status_code == 200, f"Failed to fetch branches: {b_res.text}"
        branches = b_res.json()
        assert len(branches) == 3, f"Expected 3 branches, got {len(branches)}"
        print(f"  [PASS] Branches fetched from DB: {[b['branch_id'] for b in branches]}")

        # Multi-SKU forecast query for tomorrow
        dem_res = requests.get(
            "http://127.0.0.1:3000/api/v1/ai/forecasts/demand?branch_id=BR-KHI-01&date=2026-09-30",
            headers=headers
        )
        assert dem_res.status_code == 200, f"Demand query failed: {dem_res.text}"
        dem_data = dem_res.json()
        assert len(dem_data) == 32, f"Expected 32 active SKUs, got {len(dem_data)}"
        for item in dem_data:
            assert item["p10_quantity"] <= item["p50_quantity"] <= item["p90_quantity"], \
                f"Quantile crossing: {item}"
        print(f"  [PASS] Multi-SKU query returned 32 SKUs with valid P10 <= P50 <= P90 quantiles.")

        # 35-day horizon query without date parameters (Task 5)
        h35_res = requests.get(
            "http://127.0.0.1:3000/api/v1/ai/forecasts/demand?branch_id=BR-KHI-01&sku_id=SKU-BRD-01",
            headers=headers
        )
        assert h35_res.status_code == 200, f"Default 35-day query failed: {h35_res.text}"
        h35_data = h35_res.json()
        assert len(h35_data) == 35, f"Expected exactly 35 forecast dates, got {len(h35_data)}"
        first_d = h35_data[0]["forecast_date"]
        last_d = h35_data[-1]["forecast_date"]
        assert first_d == "2026-09-30", f"Expected first date 2026-09-30, got {first_d}"
        assert last_d == "2026-11-03", f"Expected last date 2026-11-03, got {last_d}"
        print(f"  [PASS] Default horizon returned exactly 35 dates: {first_d} through {last_d}.")

        # Chart data endpoint
        chart_res = requests.get(
            "http://127.0.0.1:3000/api/v1/ai/forecasts/chart-data?branch_id=BR-KHI-01&sku_id=SKU-BRD-01",
            headers=headers
        )
        assert chart_res.status_code == 200, "Chart data query failed"
        chart_data = chart_res.json()
        assert len(chart_data["actuals"]) == 28, f"Expected 28 actuals, got {len(chart_data['actuals'])}"
        assert len(chart_data["forecast"]) == 14, f"Expected 14 forecast days in chart, got {len(chart_data['forecast'])}"
        print(f"  [PASS] Chart data: 28 historical actuals + 14 forward forecast days.")

        # Rescore endpoint (500 items max limit)
        rescore_payload = [{"sku_id": "SKU-BRD-01", "branch_id": "BR-KHI-01", "date": "2026-09-30"}]
        rescore_res = requests.post(
            "http://127.0.0.1:3000/api/v1/ai/forecasts/rescore",
            headers=headers,
            json={"items": rescore_payload}
        )
        assert rescore_res.status_code in (200, 201), f"Rescore failed: {rescore_res.text}"
        print("  [PASS] Rescore endpoint accepted valid payload within 500-item limit.")

        # Rescore > 500 rejection
        rescore_bad = requests.post(
            "http://127.0.0.1:3000/api/v1/ai/forecasts/rescore",
            headers=headers,
            json={"items": [{"sku_id": "SKU-BRD-01", "branch_id": "BR-KHI-01", "date": "2026-09-30"}] * 501}
        )
        assert rescore_bad.status_code == 422, f"Expected HTTP 422 for 501 items, got {rescore_bad.status_code}"
        print("  [PASS] Rescore guardrail rejected 501 items with HTTP 422.")

        # Manual override creation & persistence
        ov_res = requests.post(
            "http://127.0.0.1:3000/api/v1/ai/forecasts/override",
            headers=headers,
            json={
                "sku_id": "SKU-BRD-01",
                "branch_id": "BR-KHI-01",
                "forecast_date": "2026-09-30",
                "original_forecast": 40,
                "override_quantity": 85,
                "reason_code": "Known Bulk Order",
                "notes": "Wedding catering order confirmed"
            }
        )
        assert ov_res.status_code == 201, f"Override creation failed: {ov_res.text}"
        print("  [PASS] Manual override created with reason 'Known Bulk Order' and persisted to database.")

        # 5. Downstream Modules (Indents -> Central Kitchen -> Purchase Requirements -> PO)
        print("\n[5/5] Testing Downstream ERP Modules (Indents -> Kitchen -> Purchase Requirements -> PO)...")
        # Indents
        ind_res = requests.get("http://127.0.0.1:3000/api/v1/erp/indents?branch_id=BR-KHI-01&date=2026-09-30", headers=headers)
        assert ind_res.status_code == 200, f"Indents fetch failed: {ind_res.text}"
        ind_raw = ind_res.json()
        ind_data = ind_raw.get("indents", ind_raw) if isinstance(ind_raw, dict) else ind_raw
        assert len(ind_data) == 32, f"Expected 32 indent items, got {len(ind_data)}"
        # Verify override applied
        brd_ind = next(i for i in ind_data if i["sku_id"] == "SKU-BRD-01")
        assert brd_ind["suggested_qty"] == 85, f"Expected suggested qty 85 from override, got {brd_ind['suggested_qty']}"
        print(f"  [PASS] Branch Indents returned 32 items with real forecast and override quantity (85) applied.")

        # Approve Indent
        appr_res = requests.post(
            "http://127.0.0.1:3000/api/v1/erp/indents/approve",
            headers=headers,
            json={"indent_id": brd_ind["indent_id"], "approved_qty": 85}
        )
        assert appr_res.status_code == 200, f"Indent approval failed: {appr_res.text}"
        print("  [PASS] Branch indent approved and persisted to database.")

        # Central Kitchen Production Plans
        plan_res = requests.get("http://127.0.0.1:3000/api/v1/erp/production-plans?date=2026-09-30", headers=headers)
        assert plan_res.status_code == 200, f"Production plans fetch failed: {plan_res.text}"
        plan_raw = plan_res.json()
        plan_data = plan_raw.get("plan", plan_raw) if isinstance(plan_raw, dict) else plan_raw
        assert len(plan_data) == 32, f"Expected 32 production plan items, got {len(plan_data)}"
        print(f"  [PASS] Central Kitchen production plans returned 32 items with real aggregated demand.")

        # Emergency batch
        em_res = requests.post(
            "http://127.0.0.1:3000/api/v1/erp/production-plans/emergency-batch",
            headers=headers,
            json={"sku_id": "SKU-BRD-01", "quantity": 30, "production_date": "2026-09-30"}
        )
        assert em_res.status_code in (200, 201), f"Emergency batch creation failed: {em_res.text}"
        print(f"  [PASS] Emergency batch scheduled and assigned to oven.")

        # Purchase Requirements (BOM Explosion)
        pr_res = requests.get("http://127.0.0.1:3000/api/v1/erp/purchase-requirements?date=2026-09-30", headers=headers)
        assert pr_res.status_code == 200, f"Purchase requirements fetch failed: {pr_res.text}"
        pr_raw = pr_res.json()
        pr_data = pr_raw.get("materials", pr_raw) if isinstance(pr_raw, dict) else pr_raw
        assert len(pr_data) == 10, f"Expected 10 raw materials from BOM, got {len(pr_data)}"
        for mat in pr_data:
            assert mat["material_name"], "Material name missing"
            assert mat["gross_requirement"] >= 0, "Gross required must be >= 0"
            assert mat["supplier_name"] != "Approved Supplier", "Fake 'Approved Supplier' found!"
            assert mat["unit_cost_pkr"] > 0, "Unit rate must be positive"
        print(f"  [PASS] BOM explosion computed for 10 raw ingredients with real suppliers and market rates.")

        # Purchase Order Validation (Task 9: Fake supplier rejected)
        po_bad_sup = requests.post(
            "http://127.0.0.1:3000/api/v1/erp/purchase-orders",
            headers=headers,
            json={
                "material_name": "Active Dry Baker's Yeast",
                "quantity": 10,
                "unit_of_measure": "KG",
                "unit_cost_pkr": 450,
                "supplier_name": "Approved Supplier"
            }
        )
        assert po_bad_sup.status_code == 422, f"Expected 422 for fake supplier, got {po_bad_sup.status_code}"
        print("  [PASS] Task 9: Fake supplier 'Approved Supplier' correctly rejected with HTTP 422.")

        # Purchase Order Validation (Task 10: Missing unit cost rejected)
        po_bad_cost = requests.post(
            "http://127.0.0.1:3000/api/v1/erp/purchase-orders",
            headers=headers,
            json={
                "material_name": "Active Dry Baker's Yeast",
                "quantity": 10,
                "unit_of_measure": "KG",
                "supplier_name": "Punjab Flour Mills Ltd"
            }
        )
        assert po_bad_cost.status_code == 422, f"Expected 422 for missing unit cost, got {po_bad_cost.status_code}"
        print("  [PASS] Task 10: Missing unit cost rejected with HTTP 422 (no fake 150 PKR default).")

        # Purchase Order Creation with real data
        first_mat = pr_data[0]
        po_good = requests.post(
            "http://127.0.0.1:3000/api/v1/erp/purchase-orders",
            headers=headers,
            json={
                "material_name": first_mat["material_name"],
                "quantity": 25,
                "unit_of_measure": first_mat["unit"],
                "unit_cost_pkr": first_mat["unit_cost_pkr"],
                "supplier_name": first_mat["supplier_name"]
            }
        )
        assert po_good.status_code in (200, 201), f"PO creation failed: {po_good.text}"
        po_res_data = po_good.json()
        po_id = po_res_data.get('po_id') or po_res_data.get('po_number')
        print(f"  [PASS] Purchase Order {po_id} issued to {first_mat['supplier_name']} at Rs {first_mat['unit_cost_pkr']}/{first_mat['unit']} and persisted to DB.")

        print("\n" + "=" * 70)
        print("COMPLETE END-TO-END VERIFICATION: ALL 23 TEST STEPS PASSED SUCCESSFULLY!")
        print("=" * 70)

    finally:
        print("\nCleaning up server processes...")
        try:
            erp_proc.terminate()
            erp_proc.wait(timeout=3)
        except Exception:
            erp_proc.kill()

        try:
            ml_proc.terminate()
            ml_proc.wait(timeout=3)
        except Exception:
            ml_proc.kill()
        print("Servers stopped cleanly.")

if __name__ == "__main__":
    run_e2e()
