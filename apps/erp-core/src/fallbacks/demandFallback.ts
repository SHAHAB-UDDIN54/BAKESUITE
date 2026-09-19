import { pool } from '../db/index.js';
import { formatPKR } from '../utils/formatters.js';

export interface FallbackForecastResult {
  sku_id: string;
  branch_id: string;
  forecast_date: string;
  p10_quantity: number;
  p50_quantity: number;
  p90_quantity: number;
  unit_of_measure: string;
  expected_revenue_pkr: number;
  confidence_score: null;
  confidence_band: null;
  badge: 'Fallback estimate';
  model_version: 'fallback-v1.0-deterministic';
  served_from: 'ERP_FALLBACK_CACHE';
  event_context: string;
}

/**
 * Calculates 4-week same-weekday moving average from historical invoice lines.
 * Applies Ramadan & Eid uplift multipliers where applicable.
 * Adheres strictly to AC-4: response in <2 seconds, Fallback estimate badge, no confidence score.
 */
export async function calculateDeterministicFallback(
  branchId: string,
  skuId: string,
  targetDateStr: string
): Promise<FallbackForecastResult> {
  const targetDate = new Date(targetDateStr);
  const dow = targetDate.getDay(); // 0=Sun .. 6=Sat

  // Query trailing 4 same-weekday occurrences
  const query = `
    SELECT 
      DATE(i.business_date) as b_date,
      SUM(l.quantity) as day_qty,
      AVG(l.unit_price) as avg_price
    FROM public.pos_invoices i
    JOIN public.pos_invoice_lines l ON i.invoice_id = l.invoice_id
    WHERE i.branch_id = $1 
      AND l.sku_id = $2
      AND i.business_date < $3
      AND EXTRACT(DOW FROM i.business_date) = $4
    GROUP BY DATE(i.business_date)
    ORDER BY b_date DESC
    LIMIT 4;
  `;

  const { rows } = await pool.query(query, [branchId, skuId, targetDate.toISOString().split('T')[0], dow]);

  let avgQty = 10;
  let unitPrice = 200.00;

  if (rows.length > 0) {
    const sum = rows.reduce((acc, r) => acc + parseInt(r.day_qty, 10), 0);
    avgQty = Math.max(1, Math.round(sum / rows.length));
    unitPrice = parseFloat(rows[0].avg_price);
  }

  // Check event uplift factor
  const month = targetDate.getMonth() + 1;
  let eventContext = 'Normal';
  let upliftMultiplier = 1.0;

  // Friday / Weekend uplift (+30% to +50%)
  if (dow === 5 || dow === 6 || dow === 0) {
    upliftMultiplier = 1.4;
  }

  // Pre-Eid / Ramadan seasonal multiplier
  if (month === 5 || month === 6) {
    eventContext = 'Ramadan / Eid Pre-season';
    upliftMultiplier *= 1.35;
  }

  const p50 = Math.round(avgQty * upliftMultiplier);
  const p10 = Math.max(1, Math.round(p50 * 0.70));
  const p90 = Math.round(p50 * 1.35);
  const expectedRevenue = p50 * unitPrice;

  return {
    sku_id: skuId,
    branch_id: branchId,
    forecast_date: targetDateStr,
    p10_quantity: p10,
    p50_quantity: p50,
    p90_quantity: p90,
    unit_of_measure: 'PCS',
    expected_revenue_pkr: expectedRevenue,
    confidence_score: null, // AC-4: No confidence score on fallback
    confidence_band: null,
    badge: 'Fallback estimate',
    model_version: 'fallback-v1.0-deterministic',
    served_from: 'ERP_FALLBACK_CACHE',
    event_context: eventContext,
  };
}
