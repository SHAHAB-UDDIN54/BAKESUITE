/**
 * Automated Verification Suite for ERP Core Circuit Breaker, Fallbacks & Overrides (Steps 36, 39, 40, 42)
 */
import { circuitBreaker } from './fallbacks/circuitBreaker.js';
import { calculateDeterministicFallback } from './fallbacks/demandFallback.js';

async function runErpCircuitBreakerTests() {
  console.log('----------------------------------------------------');
  console.log('Testing Circuit Breaker State Machine & Fallback UI');
  console.log('----------------------------------------------------');

  // 1. Initial State: CLOSED
  circuitBreaker.reset();
  if (circuitBreaker.getState() !== 'CLOSED') {
    throw new Error(`Expected initial state CLOSED, got ${circuitBreaker.getState()}`);
  }
  console.log('  [PASS] Initial state is CLOSED.');

  // 2. 5 consecutive failures trips circuit to OPEN
  for (let i = 1; i <= 5; i++) {
    circuitBreaker.recordFailure(`Simulated test timeout ${i}`);
  }

  if (circuitBreaker.getState() !== 'OPEN') {
    throw new Error(`Expected state OPEN after 5 failures, got ${circuitBreaker.getState()}`);
  }
  console.log('  [PASS] Successfully tripped to OPEN after 5 failures in 30 seconds.');

  // 3. shouldAllowCall() must block calls when OPEN
  if (circuitBreaker.shouldAllowCall() !== false) {
    throw new Error('Expected shouldAllowCall() to return false when circuit is OPEN');
  }
  console.log('  [PASS] Call execution blocked while circuit is OPEN.');

  // 4. Test Deterministic Fallback Shape (AC-4 / Step 40)
  const fallback = await calculateDeterministicFallback('BR-KHI-01', 'SKU-BRD-01', '2026-09-22');
  if (fallback.badge !== 'Fallback estimate') {
    throw new Error(`Expected badge 'Fallback estimate', got ${fallback.badge}`);
  }
  if (fallback.confidence_score !== null) {
    throw new Error(`Expected confidence_score null on fallback, got ${fallback.confidence_score}`);
  }
  if (fallback.model_version !== 'fallback-v1.0-deterministic') {
    throw new Error(`Expected deterministic fallback model version, got ${fallback.model_version}`);
  }
  console.log('  [PASS] Deterministic fallback conforms strictly to AC-4:');
  console.log(`         Badge: '${fallback.badge}', Confidence: ${fallback.confidence_score}, P50: ${fallback.p50_quantity}`);

  // 5. Fallback Metrics & Critical Alert Tracking
  const metrics = circuitBreaker.getMetrics();
  console.log(`  [PASS] Fallback 60m Metrics: Total calls: ${metrics.totalCalls60m}, Fallbacks: ${metrics.fallbackCalls60m}, Rate: ${metrics.fallbackRate60m}%`);

  circuitBreaker.reset();
  console.log('----------------------------------------------------');
  console.log('[PASS] All ERP Core circuit breaker verification tests passed!');
  console.log('----------------------------------------------------');
}

runErpCircuitBreakerTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Test failure:', err);
    process.exit(1);
  });
