import { Router, Request, Response } from 'express';
import { calculateDeterministicFallback } from '../fallbacks/demandFallback.js';
import { circuitBreaker } from '../fallbacks/circuitBreaker.js';
import { config } from '../config/index.js';

export const forecastsRouter = Router();

/**
 * GET /api/v1/ai/forecasts/circuit-breaker
 * Exposes current circuit breaker metrics and fallback rate for live telemetry and testing.
 */
forecastsRouter.get('/forecasts/circuit-breaker', (req: Request, res: Response) => {
  return res.json(circuitBreaker.getMetrics());
});

/**
 * GET /api/v1/ai/forecasts/demand
 * Proxy endpoint that queries ML microservice or transparently triggers
 * the deterministic 4-week fallback engine on timeout (>1200ms) or circuit breaker trip.
 */
forecastsRouter.get('/forecasts/demand', async (req: Request, res: Response) => {
  const branchId = (req.query.branch_id as string) || 'BR-KHI-01';
  const skuId = (req.query.sku_id as string) || 'SKU-BRD-01';
  const dateStr = (req.query.date as string) || (req.query.date_from as string) || new Date().toISOString().split('T')[0];

  // RBAC Branch Scope Enforcement (Step 42)
  const allowedBranchesHeader = req.headers['x-user-branches'] as string;
  if (allowedBranchesHeader) {
    const allowed = allowedBranchesHeader.split(',').map(b => b.trim());
    if (!allowed.includes(branchId) && !allowed.includes('*')) {
      return res.status(403).json({
        error: `Access Denied: User is not authorized for branch ${branchId}`,
        authorized_branches: allowed
      });
    }
  }

  const startTime = Date.now();

  // 1. Check Circuit Breaker State (Step 39 & 40)
  if (!circuitBreaker.shouldAllowCall()) {
    console.warn(`[ERP-PROXY] Circuit breaker is OPEN. Fast-failing to deterministic fallback for ${skuId} @ ${branchId}`);
    const fallbackResult = await calculateDeterministicFallback(branchId, skuId, dateStr);
    const duration = Date.now() - startTime;
    res.setHeader('X-Circuit-Breaker-State', 'OPEN');
    res.setHeader('X-Response-Time-Ms', duration.toString());
    return res.json(fallbackResult);
  }

  try {
    // Attempt to call ML Service with 1200ms timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);

    const mlUrl = `${config.mlServiceUrl}/ml/v1/forecast/demand?branch_id=${branchId}&sku_id=${skuId}&date=${dateStr}`;
    const response = await fetch(mlUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      circuitBreaker.recordSuccess();
      res.setHeader('X-Circuit-Breaker-State', circuitBreaker.getState());
      res.setHeader('X-Response-Time-Ms', (Date.now() - startTime).toString());
      return res.json(data);
    }
    
    // Non-2xx response from ML service
    circuitBreaker.recordFailure(`ML service returned status ${response.status}`);
    throw new Error(`ML service returned status ${response.status}`);
  } catch (error: any) {
    const isTimeout = error.name === 'AbortError' || error.message?.includes('aborted');
    const reason = isTimeout ? 'ML service call exceeded 1200ms timeout' : (error.message || 'Connection refused');
    
    circuitBreaker.recordFailure(reason);

    console.warn(`[ERP-PROXY] ML Service unreachable (${reason}), falling back to deterministic engine for ${skuId} @ ${branchId}`);
    const fallbackResult = await calculateDeterministicFallback(branchId, skuId, dateStr);
    const duration = Date.now() - startTime;
    res.setHeader('X-Circuit-Breaker-State', circuitBreaker.getState());
    res.setHeader('X-Response-Time-Ms', duration.toString());
    return res.json(fallbackResult);
  }
});

