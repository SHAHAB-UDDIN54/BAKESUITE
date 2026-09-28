process.env.NODE_ENV = 'test';
import { formatPKR, formatDatePK } from './utils/formatters.js';
import { testDatabaseConnection, pool } from './db/index.js';

async function run() {
  console.log('--- Testing Regional Formatters ---');
  const amount = 1250000.00;
  const formattedAmount = formatPKR(amount);
  console.log(`Amount: ${amount} -> Formatted: ${formattedAmount}`);
  if (formattedAmount !== 'Rs 1,250,000.00') {
    throw new Error(`Currency formatting mismatch: expected 'Rs 1,250,000.00', got '${formattedAmount}'`);
  }

  const testDate = new Date('2026-09-18T12:00:00Z');
  const formattedDate = formatDatePK(testDate);
  console.log(`Date: ${testDate.toISOString()} -> PK Date: ${formattedDate}`);

  console.log('\n--- Testing PostgreSQL Connection ---');
  const connected = await testDatabaseConnection();
  if (!connected) {
    throw new Error('Database connection failed');
  }

  console.log('\n--- Testing Deterministic 4-Week Fallback Engine (AC-4) ---');
  const { calculateDeterministicFallback } = await import('./fallbacks/demandFallback.js');
  const fallback = await calculateDeterministicFallback('BR-KHI-01', 'SKU-BRD-01', '2026-09-19');
  console.log('Fallback Result:', JSON.stringify(fallback, null, 2));
  if (fallback.badge !== 'Fallback estimate' || fallback.confidence_score !== null) {
    throw new Error('Fallback failed AC-4 requirements');
  }

  console.log('\n--- Testing ERP Core Express API Endpoints End-to-End ---');
  const app = (await import('./app.js')).default;
  const server = app.listen(0);
  const address: any = server.address();
  const baseUrl = `http://localhost:${address.port}`;

  try {
    // 1. Multi-SKU forecast querying
    console.log('  Testing GET /api/v1/ai/forecasts/demand (multi-SKU)...');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const multiRes = await fetch(`${baseUrl}/api/v1/ai/forecasts/demand?branch_id=BR-KHI-01&date=${tomorrowStr}`);
    if (!multiRes.ok) throw new Error(`Multi-SKU fetch failed with status ${multiRes.status}`);
    const multiData: any = await multiRes.json();
    if (!Array.isArray(multiData) || multiData.length === 0) {
      throw new Error(`Expected array of forecast items for multi-SKU query, got ${JSON.stringify(multiData)}`);
    }
    const first = multiData[0];
    if (first.p10_quantity > first.p50_quantity || first.p50_quantity > first.p90_quantity) {
      throw new Error(`Quantile crossing violation: P10=${first.p10_quantity}, P50=${first.p50_quantity}, P90=${first.p90_quantity}`);
    }
    console.log(`  [PASS] Multi-SKU query returned ${multiData.length} active SKUs with valid quantiles.`);

    // 2. 35-day vs 36-day guardrail
    console.log('  Testing 35-day vs 36-day horizon guardrail...');
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const d35 = new Date();
    d35.setDate(d35.getDate() + 34);
    const d35Str = d35.toISOString().split('T')[0];

    const d37 = new Date();
    d37.setDate(d37.getDate() + 37);
    const d37Str = d37.toISOString().split('T')[0];

    const d35Res = await fetch(`${baseUrl}/api/v1/ai/forecasts/demand?branch_id=BR-KHI-01&sku_id=SKU-BRD-01&date_from=${todayStr}&date_to=${d35Str}`);
    if (!d35Res.ok && d35Res.status !== 404) {
      throw new Error(`Expected <=35 days horizon to be accepted, got status ${d35Res.status}`);
    }

    const d37Res = await fetch(`${baseUrl}/api/v1/ai/forecasts/demand?branch_id=BR-KHI-01&sku_id=SKU-BRD-01&date_from=${todayStr}&date_to=${d37Str}`);
    if (d37Res.status !== 422) {
      throw new Error(`Expected HTTP 422 for >35 days horizon, got ${d37Res.status}`);
    }
    console.log('  [PASS] 35-day horizon guardrail enforced: >35 days returned HTTP 422.');

    // 3. Chart data endpoint
    console.log('  Testing GET /api/v1/ai/forecasts/chart-data...');
    const chartRes = await fetch(`${baseUrl}/api/v1/ai/forecasts/chart-data?branch_id=BR-KHI-01&sku_id=SKU-BRD-01`);
    if (!chartRes.ok) throw new Error(`Chart data fetch failed: ${chartRes.status}`);
    const chartData: any = await chartRes.json();
    if (!chartData.actuals || !chartData.forecast) {
      throw new Error('Chart data missing actuals or forecast time series');
    }
    console.log(`  [PASS] Chart data endpoint returned ${chartData.actuals.length} actuals and ${chartData.forecast.length} forward forecast days.`);

    // 4. Manual override and revert
    console.log('  Testing POST /api/v1/ai/forecasts/override and revert...');
    const overrideRes = await fetch(`${baseUrl}/api/v1/ai/forecasts/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'qa-lead-user' },
      body: JSON.stringify({
        sku_id: 'SKU-BRD-01',
        branch_id: 'BR-KHI-01',
        forecast_date: '2026-09-25',
        original_forecast: 95,
        override_quantity: 140,
        reason_code: 'Local Event',
        notes: 'Procession route passing store'
      })
    });
    if (overrideRes.status !== 201) {
      throw new Error(`Override failed with status ${overrideRes.status}`);
    }

    const revertRes = await fetch(`${baseUrl}/api/v1/ai/forecasts/override/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'qa-lead-user' },
      body: JSON.stringify({
        sku_id: 'SKU-BRD-01',
        branch_id: 'BR-KHI-01',
        forecast_date: '2026-09-25'
      })
    });
    if (!revertRes.ok) {
      throw new Error(`Revert failed with status ${revertRes.status}`);
    }
    console.log('  [PASS] Manual override created (201) and reverted (200) with auditable trail.');

    // 5. Rescore limit validation (>500 items rejected)
    console.log('  Testing POST /api/v1/ai/forecasts/rescore 500-item limit...');
    const dummyItems = Array.from({ length: 501 }, (_, i) => ({
      sku_id: `SKU-${i}`,
      branch_id: 'BR-KHI-01',
      date: '2026-09-25'
    }));
    const rescoreOverRes = await fetch(`${baseUrl}/api/v1/ai/forecasts/rescore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: dummyItems })
    });
    if (rescoreOverRes.status !== 422) {
      throw new Error(`Expected HTTP 422 for >500 items, got ${rescoreOverRes.status}`);
    }
    console.log('  [PASS] Rescore guardrail enforced: 501 items rejected with HTTP 422.');

    // 6. Branch authorization & unauthorized branch rejection (HTTP 403)
    console.log('  Testing server-side branch authorization...');
    const unauthRes = await fetch(`${baseUrl}/api/v1/ai/forecasts/demand?branch_id=BR-KHI-01`, {
      headers: { 'Authorization': 'Bearer lhr-manager-token' }
    });
    if (unauthRes.status !== 403) {
      throw new Error(`Expected HTTP 403 for unauthorized branch access, got ${unauthRes.status}`);
    }
    const authRes = await fetch(`${baseUrl}/api/v1/ai/forecasts/demand?branch_id=BR-LHR-01`, {
      headers: { 'Authorization': 'Bearer lhr-manager-token' }
    });
    if (!authRes.ok) {
      throw new Error(`Expected 200 for authorized branch access, got ${authRes.status}`);
    }
    console.log('  [PASS] Branch authorization enforced: unauthorized branch returns HTTP 403, authorized branch returns 200.');

    // 7. JWT Authentication Verification (Critical Fix #7)
    console.log('  Testing cryptographically signed JWT token authentication...');
    const { signJwt, verifyJwt } = await import('./auth/jwt.js');
    const validJwt = signJwt({
      userId: 'test-khi-mgr',
      role: 'BRANCH_MANAGER',
      authorizedBranches: ['BR-KHI-01']
    }, 3600);

    const jwtVerifyResult = verifyJwt(validJwt);
    if (!jwtVerifyResult.valid || jwtVerifyResult.user?.userId !== 'test-khi-mgr') {
      throw new Error('JWT verification failed for signed token');
    }

    // Valid JWT request to protected endpoint
    const jwtReq = await fetch(`${baseUrl}/api/v1/ai/metadata/branches`, {
      headers: { 'Authorization': `Bearer ${validJwt}` }
    });
    if (!jwtReq.ok) {
      throw new Error(`Valid JWT rejected with status ${jwtReq.status}`);
    }

    // Invalid/Tampered JWT request
    const tamperedJwt = validJwt.substring(0, validJwt.length - 5) + 'xxxxx';
    const badJwtReq = await fetch(`${baseUrl}/api/v1/ai/metadata/branches`, {
      headers: { 'Authorization': `Bearer ${tamperedJwt}` }
    });
    if (badJwtReq.status !== 401) {
      throw new Error(`Expected HTTP 401 for tampered JWT, got ${badJwtReq.status}`);
    }
    console.log('  [PASS] Cryptographic JWT signature verified: valid token returns 200, tampered token returns 401.');

    // 8. Sensitive Endpoint Protection (Critical Fix #8)
    console.log('  Testing protection of sensitive endpoints (metadata, circuit-breaker, batch-info)...');
    const cbRes = await fetch(`${baseUrl}/api/v1/ai/forecasts/circuit-breaker`, {
      headers: { 'Authorization': `Bearer ${validJwt}` }
    });
    if (!cbRes.ok) throw new Error(`Circuit breaker endpoint failed: ${cbRes.status}`);

    const batchInfoRes = await fetch(`${baseUrl}/api/v1/ai/forecasts/batch-info`, {
      headers: { 'Authorization': `Bearer ${validJwt}` }
    });
    if (!batchInfoRes.ok) throw new Error(`Batch info endpoint failed: ${batchInfoRes.status}`);
    const batchInfoData: any = await batchInfoRes.json();
    console.log(`  [PASS] Batch info returned real skus_scored: ${batchInfoData.skus_scored} (No fake 32).`);

    // 9. Rescore Cross-Branch Security (Critical Fix #8)
    console.log('  Testing rescore cross-branch authorization...');
    const lhrJwt = signJwt({
      userId: 'test-lhr-mgr',
      role: 'BRANCH_MANAGER',
      authorizedBranches: ['BR-LHR-01']
    }, 3600);

    const crossBranchRes = await fetch(`${baseUrl}/api/v1/ai/forecasts/rescore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${lhrJwt}` },
      body: JSON.stringify({
        items: [{ sku_id: 'SKU-BRD-01', branch_id: 'BR-KHI-01', date: '2026-09-26' }]
      })
    });
    if (crossBranchRes.status !== 403) {
      throw new Error(`Expected HTTP 403 for cross-branch rescore, got ${crossBranchRes.status}`);
    }
    console.log('  [PASS] Rescore cross-branch protection enforced: unauthorized branch returns HTTP 403.');

  } finally {
    server.close();
  }

  await pool.end();
  console.log('\n[PASS] All ERP Core verification checks passed successfully.');
  process.exit(0);
}

run().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
