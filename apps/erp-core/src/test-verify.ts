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

  await pool.end();
  console.log('\n[PASS] All ERP Core verification checks passed successfully.');
}

run().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
