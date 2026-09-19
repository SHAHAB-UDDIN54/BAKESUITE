import { Router, Request, Response } from 'express';
import { calculateDeterministicFallback } from '../fallbacks/demandFallback.js';
import { config } from '../config/index.js';

export const forecastsRouter = Router();

/**
 * GET /api/v1/ai/forecasts/demand
 * Proxy endpoint that queries ML microservice or transparently triggers
 * the deterministic 4-week fallback engine on timeout / failure.
 */
forecastsRouter.get('/forecasts/demand', async (req: Request, res: Response) => {
  const branchId = (req.query.branch_id as string) || 'BR-KHI-01';
  const skuId = (req.query.sku_id as string) || 'SKU-BRD-01';
  const dateStr = (req.query.date as string) || (req.query.date_from as string) || new Date().toISOString().split('T')[0];

  const startTime = Date.now();

  try {
    // Attempt to call ML Service with 1200ms timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);

    const mlUrl = `${config.mlServiceUrl}/ml/v1/forecast/demand?branch_id=${branchId}&sku_id=${skuId}&date=${dateStr}`;
    const response = await fetch(mlUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return res.json(data);
    }
    throw new Error(`ML service returned status ${response.status}`);
  } catch (error) {
    // Fallback: Trigger deterministic TypeScript fallback engine (AC-4)
    console.warn(`[ERP-PROXY] ML Service unreachable, falling back to deterministic engine for ${skuId} @ ${branchId}`);
    const fallbackResult = await calculateDeterministicFallback(branchId, skuId, dateStr);
    const duration = Date.now() - startTime;
    res.setHeader('X-Response-Time-Ms', duration.toString());
    return res.json(fallbackResult);
  }
});
