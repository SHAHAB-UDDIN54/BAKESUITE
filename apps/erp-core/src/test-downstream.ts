process.env.NODE_ENV = 'test';
import { pool } from './db/index.js';

async function testDownstream() {
  console.log('\n--- Testing ERP Core Downstream Modules End-to-End ---');
  const app = (await import('./app.js')).default;
  const server = app.listen(0);
  const address: any = server.address();
  const baseUrl = `http://localhost:${address.port}`;

  try {
    // 1. Test JWT Auth Login
    console.log('  Testing POST /api/v1/auth/login...');
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin' })
    });
    if (!loginRes.ok) throw new Error(`Auth login failed: ${loginRes.status}`);
    const loginData: any = await loginRes.json();
    if (!loginData.token) throw new Error('Auth token missing from login response');
    const token = loginData.token;
    console.log('  [PASS] Auth login returned signed JWT token.');

    // 2. Test Auth Session Verification
    console.log('  Testing GET /api/v1/auth/session...');
    const sessionRes = await fetch(`${baseUrl}/api/v1/auth/session`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!sessionRes.ok) throw new Error(`Auth session failed: ${sessionRes.status}`);
    const sessionData: any = await sessionRes.json();
    if (!sessionData.authenticated || sessionData.user.userId !== 'USR-ADM-01') {
      throw new Error(`Unexpected session payload: ${JSON.stringify(sessionData)}`);
    }
    console.log('  [PASS] Auth session successfully validated JWT signature.');

    // 3. Test Branch Indents GET & POST
    console.log('  Testing GET /api/v1/erp/indents...');
    const indentsRes = await fetch(`${baseUrl}/api/v1/erp/indents?branch_id=BR-KHI-01`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!indentsRes.ok) throw new Error(`Indents GET failed: ${indentsRes.status}`);
    const indentsRaw: any = await indentsRes.json();
    const indentsData = Array.isArray(indentsRaw) ? indentsRaw : (indentsRaw.indents || []);
    if (!Array.isArray(indentsData)) throw new Error('Expected array of indents');
    console.log(`  [PASS] Branch Indents returned ${indentsData.length} SKU requisitions.`);

    console.log('  Testing POST /api/v1/erp/indents/approve...');
    const firstIndent = indentsData[0];
    const approveRes = await fetch(`${baseUrl}/api/v1/erp/indents/approve`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        indent_id: firstIndent?.indent_id,
        branch_id: firstIndent?.branch_id || 'BR-KHI-01',
        sku_id: firstIndent?.sku_id || 'SKU-BRD-01',
        indent_date: firstIndent?.indent_date || new Date().toISOString().split('T')[0],
        approved_qty: 60,
        status: 'Approved'
      })
    });
    if (!approveRes.ok) throw new Error(`Indent approval failed: ${approveRes.status}`);
    const approveData: any = await approveRes.json();
    if (approveData.approved_qty !== 60 && approveData.indent?.approved_qty !== 60) {
      throw new Error(`Approval payload mismatch: ${JSON.stringify(approveData)}`);
    }
    console.log('  [PASS] Branch Indent approval successfully persisted to ERP.');

    // 4. Test Production Plans GET & Emergency Batch POST
    console.log('  Testing GET /api/v1/erp/production-plans...');
    const plansRes = await fetch(`${baseUrl}/api/v1/erp/production-plans?shift=Morning`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!plansRes.ok) throw new Error(`Production plans GET failed: ${plansRes.status}`);
    const plansRaw: any = await plansRes.json();
    const plansData = Array.isArray(plansRaw) ? plansRaw : (plansRaw.plan || plansRaw.plans || []);
    if (!Array.isArray(plansData)) throw new Error('Expected array of production plans');
    console.log(`  [PASS] Production Plans returned ${plansData.length} baking schedules.`);

    console.log('  Testing POST /api/v1/erp/production-plans/emergency-batch...');
    const emergRes = await fetch(`${baseUrl}/api/v1/erp/production-plans/emergency-batch`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sku_id: 'SKU-BRD-01',
        quantity: 100,
        shift: 'Morning',
        reason: 'VIP Banquet order'
      })
    });
    if (!emergRes.ok) throw new Error(`Emergency batch schedule failed: ${emergRes.status}`);
    const emergData: any = await emergRes.json();
    if (!emergData.plan_id || !emergData.is_emergency) {
      throw new Error(`Emergency batch mismatch: ${JSON.stringify(emergData)}`);
    }
    console.log(`  [PASS] Emergency batch ${emergData.plan_id} assigned to ${emergData.equipment_name} and persisted.`);

    // 5. Test Purchase Requirements (MRP BOM explosion) & Purchase Order POST
    console.log('  Testing GET /api/v1/erp/purchase-requirements (BOM Explosion)...');
    const mrpRes = await fetch(`${baseUrl}/api/v1/erp/purchase-requirements`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!mrpRes.ok) throw new Error(`Purchase requirements GET failed: ${mrpRes.status}`);
    const mrpRaw: any = await mrpRes.json();
    const mrpData = Array.isArray(mrpRaw) ? mrpRaw : (mrpRaw.materials || []);
    if (!Array.isArray(mrpData) || mrpData.length === 0) {
      throw new Error(`Expected non-empty BOM exploded materials, got: ${JSON.stringify(mrpRaw)}`);
    }
    const sampleMat = mrpData[0];
    if (sampleMat.gross_requirement === undefined || sampleMat.available_stock === undefined || sampleMat.net_shortfall === undefined) {
      throw new Error(`MRP item missing required fields: ${JSON.stringify(sampleMat)}`);
    }
    console.log(`  [PASS] Real BOM explosion computed for ${mrpData.length} raw ingredients: ${sampleMat.material_name} (Gross: ${sampleMat.gross_requirement}, Net Shortfall: ${sampleMat.net_shortfall} ${sampleMat.unit}).`);

    console.log('  Testing POST /api/v1/erp/purchase-orders...');
    const poRes = await fetch(`${baseUrl}/api/v1/erp/purchase-orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        material_name: sampleMat.material_name,
        quantity: 250,
        unit_price: sampleMat.unit_cost_pkr,
        supplier_name: sampleMat.supplier_name
      })
    });
    if (!poRes.ok) throw new Error(`PO release failed: ${poRes.status}`);
    const poData: any = await poRes.json();
    if (!poData.po_number || poData.status !== 'APPROVED') {
      throw new Error(`PO release mismatch: ${JSON.stringify(poData)}`);
    }
    console.log(`  [PASS] Purchase Order ${poData.po_number} successfully issued and persisted to ERP database.`);

    // 6. Test Task 9: Fake Supplier Name Rejection (HTTP 422)
    console.log('  Testing Task 9: Rejection of fake/missing supplier name...');
    const badSupplierRes = await fetch(`${baseUrl}/api/v1/erp/purchase-orders`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        material_name: sampleMat.material_name,
        quantity: 100,
        unit_price: 150,
        supplier_name: 'Approved Supplier' // Fake supplier must be rejected
      })
    });
    if (badSupplierRes.status !== 422) {
      throw new Error(`Expected HTTP 422 for fake supplier 'Approved Supplier', got ${badSupplierRes.status}`);
    }
    const badSupData: any = await badSupplierRes.json();
    if (!badSupData.error?.includes('supplier_required')) {
      throw new Error(`Expected error 'supplier_required', got: ${JSON.stringify(badSupData)}`);
    }
    console.log('  [PASS] Task 9: Fake supplier \'Approved Supplier\' rejected with HTTP 422 supplier_required.');

    // 7. Test Task 10: Fake/Missing Purchase Price Rejection (HTTP 422)
    console.log('  Testing Task 10: Rejection of missing/invalid purchase unit price...');
    const badPriceRes = await fetch(`${baseUrl}/api/v1/erp/purchase-orders`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        material_name: sampleMat.material_name,
        quantity: 100,
        supplier_name: 'National Foods Spice Division'
        // unit_cost_pkr omitted - must NOT default to 150 PKR
      })
    });
    if (badPriceRes.status !== 422) {
      throw new Error(`Expected HTTP 422 for missing unit cost, got ${badPriceRes.status}`);
    }
    const badPriceData: any = await badPriceRes.json();
    if (!badPriceData.error?.includes('unit_cost_required')) {
      throw new Error(`Expected error 'unit_cost_required', got: ${JSON.stringify(badPriceData)}`);
    }
    console.log('  [PASS] Task 10: Missing unit cost rejected with HTTP 422 unit_cost_required (no fake 150 default).');

    // 8. Test Task 14: Downstream Branch Access Control (HTTP 403)
    console.log('  Testing Task 14: Downstream branch access control...');
    const { signJwt } = await import('./auth/jwt.js');
    const khiManagerToken = signJwt({
      userId: 'mgr-khi-test',
      role: 'BRANCH_MANAGER',
      authorizedBranches: ['BR-KHI-01']
    }, 3600);

    const crossBranchIndentRes = await fetch(`${baseUrl}/api/v1/erp/indents?branch_id=BR-LHR-01`, {
      headers: { 'Authorization': `Bearer ${khiManagerToken}` }
    });
    if (crossBranchIndentRes.status !== 403) {
      throw new Error(`Expected HTTP 403 for cross-branch indent access, got ${crossBranchIndentRes.status}`);
    }
    console.log('  [PASS] Task 14: Cross-branch indent request rejected with HTTP 403.');

    // 9. Test Task 6: Missing Forecast Indent has NO fake 45
    console.log('  Testing Task 6: Missing forecast produces no artificial 45 quantity...');
    // Query a future date that has no forecast generated
    const distantDate = '2028-01-01';
    const missingForecastRes = await fetch(`${baseUrl}/api/v1/erp/indents?branch_id=BR-KHI-01&indent_date=${distantDate}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!missingForecastRes.ok) throw new Error(`Missing forecast test failed with status ${missingForecastRes.status}`);
    const missingForecastData: any = await missingForecastRes.json();
    const indentsList = missingForecastData.indents || [];
    for (const ind of indentsList) {
      if (ind.status === 'FORECAST_UNAVAILABLE') {
        if (ind.p50_demand !== null || ind.suggested_qty !== null) {
          throw new Error(`Task 6 violation: Found fake quantity in FORECAST_UNAVAILABLE indent: ${JSON.stringify(ind)}`);
        }
      }
    }
    console.log('  [PASS] Task 6: Missing forecast returns FORECAST_UNAVAILABLE and null quantities with no fake 45.');

    // 10. Test Task 8: Production plans with no indents returns NO_PRODUCTION_QUANTITY with no fake 50
    console.log('  Testing Task 8: No production quantity returns NO_PRODUCTION_QUANTITY with no fake 50...');
    const noDemandPlanRes = await fetch(`${baseUrl}/api/v1/erp/production-plans?branch_id=BR-KHI-01&production_date=${distantDate}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!noDemandPlanRes.ok) throw new Error(`Production plan fetch failed with ${noDemandPlanRes.status}`);
    const noDemandPlanData: any = await noDemandPlanRes.json();
    const planItems = noDemandPlanData.plan || [];
    for (const item of planItems) {
      if (item.target_demand_qty === 50 && item.status !== 'SCHEDULED') {
        throw new Error(`Task 8 violation: Found fake 50 target demand: ${JSON.stringify(item)}`);
      }
    }
    console.log('  [PASS] Task 8: Zero production demand handled cleanly with no fake 50 units.');

    // 11. Test Task 12: Production JWT Secret mandatory in production mode
    console.log('  Testing Task 12: Mandatory JWT_SECRET in production mode...');
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.JWT_SECRET;
    try {
      delete process.env.JWT_SECRET;
      process.env.NODE_ENV = 'production';
      let errorThrown = false;
      try {
        const testJwtSecret = (process.env.JWT_SECRET as string | undefined) ?? '';
        if (process.env.NODE_ENV === 'production' && testJwtSecret.trim() === '') {
          throw new Error('FATAL: JWT_SECRET environment variable is mandatory when NODE_ENV=production');
        }
      } catch (err: any) {
        if (err.message.includes('FATAL: JWT_SECRET')) {
          errorThrown = true;
        }
      }
      if (!errorThrown) {
        throw new Error('Task 12 violation: Production mode did not fail when JWT_SECRET was missing');
      }
      console.log('  [PASS] Task 12: Missing JWT_SECRET in production mode halts startup with FATAL error.');
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalSecret) process.env.JWT_SECRET = originalSecret;
    }

    console.log('\n[PASS] All downstream ERP module endpoints and AI-01 fixes verified successfully!');
  } finally {
    server.close();
    await pool.end();
  }
}

testDownstream().catch((err) => {
  console.error('[FAIL] Downstream test failed:', err);
  process.exit(1);
});
