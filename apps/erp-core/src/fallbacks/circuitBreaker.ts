/**
 * BakeSuite ERP Circuit Breaker & Fallback Monitor (AC-4 / SRS Step 39 & 40)
 * 
 * Rules:
 * - CLOSED by default.
 * - Tripped to OPEN if 5 consecutive failures occur within a 30-second window.
 * - When OPEN, immediately serves deterministic fallback without calling ML service.
 * - After 60-second cooldown, transitions to HALF_OPEN to probe ML service.
 * - Closes after 3 consecutive successful probe responses.
 * - Fallback Rate Monitoring: Tracks fallback activations in trailing 60-minute rolling window.
 *   Emits a CRITICAL ALERT if fallback rate exceeds 5.0%.
 */

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerMetrics {
  state: CircuitBreakerState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureTime: number | null;
  lastStateChangeTime: number;
  totalCalls60m: number;
  fallbackCalls60m: number;
  fallbackRate60m: number;
  criticalAlertActive: boolean;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = 'CLOSED';
  private consecutiveFailures: number = 0;
  private consecutiveSuccesses: number = 0;
  private failureTimestamps: number[] = [];
  private lastStateChangeTime: number = Date.now();
  private lastProbeTime: number = 0;

  // Rolling 60-minute window call logs: { timestamp: number, wasFallback: boolean }
  private callWindow: Array<{ timestamp: number; wasFallback: boolean }> = [];

  private readonly FAILURE_THRESHOLD = 5;
  private readonly FAILURE_WINDOW_MS = 30000; // 30 seconds
  private readonly PROBE_INTERVAL_MS = 60000; // 60 seconds
  private readonly SUCCESS_THRESHOLD = 3;     // 3 consecutive successes to close
  private readonly ALERT_FALLBACK_RATE_THRESHOLD = 0.05; // 5%

  public getState(): CircuitBreakerState {
    const now = Date.now();
    if (this.state === 'OPEN') {
      // Check if 60-second cooldown has passed -> HALF_OPEN probe
      if (now - this.lastStateChangeTime >= this.PROBE_INTERVAL_MS) {
        this.state = 'HALF_OPEN';
        this.lastStateChangeTime = now;
        this.consecutiveSuccesses = 0;
        console.log('[CIRCUIT-BREAKER] Probe interval elapsed. Transitioning from OPEN to HALF_OPEN.');
      }
    }
    return this.state;
  }

  public shouldAllowCall(): boolean {
    const state = this.getState();
    if (state === 'CLOSED') return true;
    if (state === 'HALF_OPEN') {
      const now = Date.now();
      // Allow probe once every 10 seconds in half-open
      if (now - this.lastProbeTime >= 10000) {
        this.lastProbeTime = now;
        return true;
      }
      return false;
    }
    return false; // OPEN: block call
  }

  public recordSuccess(): void {
    this.recordCallMetric(false);
    if (this.state === 'HALF_OPEN') {
      this.consecutiveSuccesses++;
      console.log(`[CIRCUIT-BREAKER] Probe success (${this.consecutiveSuccesses}/${this.SUCCESS_THRESHOLD}).`);
      if (this.consecutiveSuccesses >= this.SUCCESS_THRESHOLD) {
        this.state = 'CLOSED';
        this.consecutiveFailures = 0;
        this.consecutiveSuccesses = 0;
        this.lastStateChangeTime = Date.now();
        console.log('[CIRCUIT-BREAKER] Circuit CLOSED. Normal ML serving resumed.');
      }
    } else {
      this.consecutiveFailures = 0;
    }
  }

  public recordFailure(reason: string): void {
    const now = Date.now();
    this.recordCallMetric(true);
    this.failureTimestamps.push(now);

    // Prune timestamps older than 30 seconds
    this.failureTimestamps = this.failureTimestamps.filter(t => now - t <= this.FAILURE_WINDOW_MS);
    this.consecutiveFailures++;

    console.warn(`[CIRCUIT-BREAKER] Failure recorded (${this.consecutiveFailures}/${this.FAILURE_THRESHOLD}) within 30s. Reason: ${reason}`);

    if (this.state === 'HALF_OPEN') {
      // Re-trip immediately
      this.state = 'OPEN';
      this.lastStateChangeTime = now;
      this.consecutiveSuccesses = 0;
      console.error('[CIRCUIT-BREAKER] Probe failed. Re-tripping circuit to OPEN.');
    } else if (this.state === 'CLOSED' && this.failureTimestamps.length >= this.FAILURE_THRESHOLD) {
      this.state = 'OPEN';
      this.lastStateChangeTime = now;
      console.error(`[CIRCUIT-BREAKER] Tripped to OPEN! ${this.failureTimestamps.length} failures occurred within 30 seconds.`);
    }
  }

  private recordCallMetric(wasFallback: boolean): void {
    const now = Date.now();
    this.callWindow.push({ timestamp: now, wasFallback });
    this.pruneCallWindow(now);

    // Evaluate 60-minute fallback rate alert
    const metrics = this.getMetrics();
    if (metrics.criticalAlertActive) {
      console.error(`🚨 [CRITICAL ALERT] Fallback rate breach! ${metrics.fallbackRate60m.toFixed(2)}% of requests served from fallback over trailing 60m (Threshold: 5.00%).`);
    }
  }

  private pruneCallWindow(now: number): void {
    const sixtyMinutesAgo = now - 60 * 60 * 1000;
    this.callWindow = this.callWindow.filter(c => c.timestamp >= sixtyMinutesAgo);
  }

  public getMetrics(): CircuitBreakerMetrics {
    const now = Date.now();
    this.pruneCallWindow(now);

    const total = this.callWindow.length;
    const fallbacks = this.callWindow.filter(c => c.wasFallback).length;
    const fallbackRate = total > 0 ? (fallbacks / total) * 100 : 0.0;
    const criticalAlert = total >= 20 && (fallbackRate / 100 > this.ALERT_FALLBACK_RATE_THRESHOLD);

    return {
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailureTime: this.failureTimestamps.length > 0 ? this.failureTimestamps[this.failureTimestamps.length - 1] : null,
      lastStateChangeTime: this.lastStateChangeTime,
      totalCalls60m: total,
      fallbackCalls60m: fallbacks,
      fallbackRate60m: round(fallbackRate, 2),
      criticalAlertActive: criticalAlert
    };
  }

  // Testing helper
  public reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.failureTimestamps = [];
    this.lastStateChangeTime = Date.now();
    this.callWindow = [];
  }
}

function round(val: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

export const circuitBreaker = new CircuitBreaker();
