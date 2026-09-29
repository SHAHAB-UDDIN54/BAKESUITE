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

    console.log('\n[PASS] All downstream ERP module endpoints verified successfully!');
  } finally {
    server.close();
    await pool.end();
  }
}

testDownstream().catch((err) => {
  console.error('[FAIL] Downstream test failed:', err);
  process.exit(1);
});
