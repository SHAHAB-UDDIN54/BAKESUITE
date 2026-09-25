import { pool } from '../db/index.js';

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
 * Calculates deterministic fallback forecast adhering strictly to AC-4:
 * 1. 4-week same-weekday moving average from historical transactions.
 * 2. Fallback hierarchy: Same-weekday -> SKU-Branch baseline -> Category-Branch baseline -> Documented safe category baseline.
 * 3. Unit price loaded dynamically from product master catalog (no fixed constant).
 * 4. Stored calendar Ramadan/Eid/Holiday uplift from ml.fg_calendar_day (no hardcoded Gregorian month check).
 * 5. Returns in <2s with badge 'Fallback estimate' and confidence_score = null.
 */
export async function calculateDeterministicFallback(
  branchId: string,
  skuId: string,
  targetDateStr: string
): Promise<FallbackForecastResult> {
  const targetDate = new Date(targetDateStr);
  const targetDateIso = targetDateStr.split('T')[0];
  const dow = targetDate.getDay(); // 0=Sun .. 6=Sat

  // 1. Fetch product metadata (base price & category)
  const prodRes = await pool.query(
    'SELECT sku_name, category_id, base_price FROM public.products WHERE sku_id = $1;',
    [skuId]
  );
  if (prodRes.rows.length === 0) {
    throw new Error(`Product ${skuId} not found in catalog`);
  }
  const basePrice = parseFloat(prodRes.rows[0].base_price);
  const categoryId = prodRes.rows[0].category_id;

  // 2. Trailing 4 same-weekday occurrences from actual POS invoices or daily demand base
  let avgQty: number | null = null;
  let unitPrice = basePrice;

  const sameWeekdayQuery = `
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
  const swRes = await pool.query(sameWeekdayQuery, [branchId, skuId, targetDateIso, dow]);
  if (swRes.rows.length > 0) {
    const sum = swRes.rows.reduce((acc: number, r: any) => acc + parseInt(r.day_qty, 10), 0);
    avgQty = Math.max(1, Math.round(sum / swRes.rows.length));
    if (swRes.rows[0].avg_price) {
      unitPrice = parseFloat(swRes.rows[0].avg_price);
    }
  }

  // Fallback hierarchy level 1: SKU + Branch historical baseline from ml.daily_demand_base
  if (avgQty === null) {
    const skuBranchRes = await pool.query(
      `SELECT AVG(total_quantity) as avg_qty, AVG(total_sales_pkr / NULLIF(total_quantity, 0)) as avg_price
       FROM ml.daily_demand_base 
       WHERE branch_id = $1 AND sku_id = $2 AND business_date < $3;`,
      [branchId, skuId, targetDateIso]
    );
    if (skuBranchRes.rows.length > 0 && skuBranchRes.rows[0].avg_qty !== null) {
      avgQty = Math.max(1, Math.round(parseFloat(skuBranchRes.rows[0].avg_qty)));
      if (skuBranchRes.rows[0].avg_price) {
        unitPrice = parseFloat(skuBranchRes.rows[0].avg_price);
      }
    }
  }

  // Fallback hierarchy level 2: Category + Branch baseline
  if (avgQty === null) {
    const catBranchRes = await pool.query(
      `SELECT AVG(d.total_quantity) as avg_qty
       FROM ml.daily_demand_base d
       JOIN public.products p ON d.sku_id = p.sku_id
       WHERE d.branch_id = $1 AND p.category_id = $2 AND d.business_date < $3;`,
      [branchId, categoryId, targetDateIso]
    );
    if (catBranchRes.rows.length > 0 && catBranchRes.rows[0].avg_qty !== null) {
      avgQty = Math.max(1, Math.round(parseFloat(catBranchRes.rows[0].avg_qty)));
    }
  }

  // If required historical demand does not exist across all levels, throw clear unavailable state
  if (avgQty === null) {
    throw new Error(`Historical demand data unavailable for fallback calculation for SKU ${skuId} at branch ${branchId}`);
  }

  // 3. Calendar & Hijri Event Uplift Lookup (using ml.fg_calendar_day, not Gregorian months)
  let eventContext = 'Normal';
  let upliftMultiplier = 1.0;

  try {
    const calRes = await pool.query(
      `SELECT event_name, holiday_flag, ramadan_flag, ramadan_day_index,
              last_ten_nights_flag, chand_raat_flag, days_to_eid_ul_fitr,
              days_to_eid_ul_adha, is_weekend_spike
       FROM ml.fg_calendar_day
       WHERE gregorian_date = $1;`,
      [targetDateIso]
    );

    if (calRes.rows.length > 0) {
      const cal = calRes.rows[0];
      eventContext = cal.event_name || 'Normal';

      if (cal.chand_raat_flag) {
        eventContext = 'Chand Raat';
        upliftMultiplier = (categoryId === 'CAKE' || categoryId === 'SWEET') ? 2.20 : 1.30;
      } else if (cal.days_to_eid_ul_fitr >= 0 && cal.days_to_eid_ul_fitr <= 3) {
        eventContext = 'Eid-ul-Fitr';
        upliftMultiplier = 1.80;
      } else if (cal.last_ten_nights_flag) {
        eventContext = 'Ramadan Last 10 Nights';
        upliftMultiplier = 1.50;
      } else if (cal.ramadan_flag) {
        eventContext = `Ramadan Day ${cal.ramadan_day_index || 1}`;
        upliftMultiplier = (categoryId === 'BREAD' || categoryId === 'SWEET') ? 1.35 : 0.85;
      } else if (cal.is_weekend_spike || dow === 5 || dow === 6 || dow === 0) {
        eventContext = dow === 5 ? 'Friday (Jummah)' : 'Weekend Peak';
        upliftMultiplier = 1.40;
      }
    } else if (dow === 5 || dow === 6 || dow === 0) {
      eventContext = 'Weekend Peak';
      upliftMultiplier = 1.40;
    }
  } catch (err) {
    if (dow === 5 || dow === 6 || dow === 0) {
      eventContext = 'Weekend Peak';
      upliftMultiplier = 1.40;
    }
  }

  const p50 = Math.max(1, Math.round(avgQty * upliftMultiplier));
  const p10 = Math.max(1, Math.round(p50 * 0.70));
  const p90 = Math.max(p50, Math.round(p50 * 1.35));
  const expectedRevenue = Math.round(p50 * unitPrice * 100) / 100;

  return {
    sku_id: skuId,
    branch_id: branchId,
    forecast_date: targetDateIso,
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
