import { Router, Request, Response } from 'express';
import { pool } from '../db/index.js';
import { authenticateUser, verifyBranchAccess } from '../auth/authMiddleware.js';

export const overridesRouter = Router();

const VALID_REASON_CODES = [
  'Local Event',
  'Known Bulk Order',
  'Supply Constraint',
  'Weather',
  'Other'
];

/**
 * Ensures table public.forecast_overrides exists for append-only audit tracking (AC-10 prep)
 */
async function ensureOverridesTable() {
  const ddl = `
    CREATE TABLE IF NOT EXISTS public.forecast_overrides (
      override_id BIGSERIAL PRIMARY KEY,
      sku_id VARCHAR(32) NOT NULL REFERENCES public.products(sku_id),
      branch_id VARCHAR(32) NOT NULL REFERENCES public.branches(branch_id),
      forecast_date DATE NOT NULL,
      original_forecast INT NOT NULL,
      override_quantity INT NOT NULL,
      reason_code VARCHAR(64) NOT NULL,
      notes TEXT,
      user_id VARCHAR(64) NOT NULL,
      model_version VARCHAR(64) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_forecast_overrides_lookup 
      ON public.forecast_overrides (branch_id, sku_id, forecast_date);
  `;
  await pool.query(ddl);
}

ensureOverridesTable().catch(err => console.error('[OVERRIDES] Table init error:', err));

/**
 * POST /api/v1/ai/forecasts/override
 * Records a signed, auditable forecast override without modifying the original ML prediction.
 */
overridesRouter.post('/forecasts/override', authenticateUser, async (req: Request, res: Response) => {
  const {
    sku_id,
    branch_id,
    forecast_date,
    original_forecast,
    override_quantity,
    reason_code,
    notes
  } = req.body;

  const userId = req.user?.userId || 'unknown';

  if (branch_id && !verifyBranchAccess(req.user, branch_id)) {
    return res.status(403).json({
      error: `Forbidden: User ${userId} is not authorized to override forecasts for branch ${branch_id}`,
      auth_status: 'BRANCH_SCOPE_VIOLATION'
    });
  }

  // 1. Validation
  if (!sku_id || !branch_id || !forecast_date) {
    return res.status(400).json({ error: 'sku_id, branch_id, and forecast_date are required' });
  }

  if (override_quantity === undefined || override_quantity === null || Number(override_quantity) <= 0) {
    return res.status(400).json({ error: 'override_quantity must be a positive integer' });
  }

  if (!VALID_REASON_CODES.includes(reason_code)) {
    return res.status(400).json({ 
      error: `Invalid reason_code. Must be one of: ${VALID_REASON_CODES.join(', ')}` 
    });
  }

  if (reason_code === 'Other' && (!notes || notes.trim().length === 0)) {
    return res.status(400).json({ 
      error: "Mandatory justification notes required when selecting 'Other' reason code" 
    });
  }

  const modelVersion = req.body.model_version || 'lgbm-v1.0-quantile';

  try {
    const insertQuery = `
      INSERT INTO public.forecast_overrides (
        sku_id, branch_id, forecast_date, original_forecast, 
        override_quantity, reason_code, notes, user_id, model_version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;

    const { rows } = await pool.query(insertQuery, [
      sku_id,
      branch_id,
      forecast_date,
      parseInt(original_forecast, 10),
      parseInt(override_quantity, 10),
      reason_code,
      notes || null,
      userId,
      modelVersion
    ]);

    console.log(`[AUDIT-OVERRIDE] SKU: ${sku_id}, Branch: ${branch_id}, Date: ${forecast_date}, Orig: ${original_forecast}, Override: ${override_quantity}, User: ${userId}, Reason: ${reason_code}`);

    return res.status(201).json({
      status: 'OVERRIDE_RECORDED',
      override: rows[0]
    });
  } catch (error) {
    console.error('[OVERRIDES] Error inserting override:', error);
    return res.status(500).json({ error: 'Failed to record manual forecast override' });
  }
});

/**
 * POST /api/v1/ai/forecasts/override/revert
 * Records an auditable reversal event restoring original baseline AI forecast.
 */
overridesRouter.post('/forecasts/override/revert', authenticateUser, async (req: Request, res: Response) => {
  const { sku_id, branch_id, forecast_date } = req.body;

  if (!sku_id || !branch_id || !forecast_date) {
    return res.status(400).json({ error: 'sku_id, branch_id, and forecast_date are required' });
  }

  const userId = req.user?.userId || 'unknown';

  if (!verifyBranchAccess(req.user, branch_id)) {
    return res.status(403).json({
      error: `Forbidden: User ${userId} is not authorized to revert overrides for branch ${branch_id}`,
      auth_status: 'BRANCH_SCOPE_VIOLATION'
    });
  }

  try {
    // Find latest override for original forecast
    const latestRes = await pool.query(`
      SELECT original_forecast, model_version
      FROM public.forecast_overrides
      WHERE sku_id = $1 AND branch_id = $2 AND forecast_date = $3
      ORDER BY created_at DESC
      LIMIT 1;
    `, [sku_id, branch_id, forecast_date]);

    if (latestRes.rows.length === 0) {
      return res.status(404).json({ error: 'No existing override found to revert' });
    }

    const orig = latestRes.rows[0].original_forecast;
    const modelVersion = latestRes.rows[0].model_version || 'lgbm-v1.0-quantile';

    const insertQuery = `
      INSERT INTO public.forecast_overrides (
        sku_id, branch_id, forecast_date, original_forecast, 
        override_quantity, reason_code, notes, user_id, model_version
      )
      VALUES ($1, $2, $3, $4, $5, 'REVERT_TO_AI', 'Manual override reverted to baseline AI P50 forecast', $6, $7)
      RETURNING *;
    `;

    const { rows } = await pool.query(insertQuery, [
      sku_id,
      branch_id,
      forecast_date,
      orig,
      orig,
      userId,
      modelVersion
    ]);

    console.log(`[AUDIT-REVERT] SKU: ${sku_id}, Branch: ${branch_id}, Date: ${forecast_date}, Restored AI P50: ${orig}`);

    return res.json({
      status: 'OVERRIDE_REVERTED',
      sku_id,
      branch_id,
      forecast_date,
      restored_quantity: orig,
      audit_record: rows[0]
    });
  } catch (error) {
    console.error('[OVERRIDES] Error reverting override:', error);
    return res.status(500).json({ error: 'Failed to revert manual override' });
  }
});

/**
 * GET /api/v1/ai/forecasts/override/analytics
 * Compares original AI forecast vs human override vs actual demand (AI-10 analytics)
 */
overridesRouter.get('/forecasts/override/analytics', authenticateUser, async (req: Request, res: Response) => {
  const branchId = req.query.branch_id as string;
  const userId = req.user?.userId || 'unknown';

  if (branchId && !verifyBranchAccess(req.user, branchId)) {
    return res.status(403).json({
      error: `Forbidden: User ${userId} is not authorized for branch ${branchId}`,
      auth_status: 'BRANCH_SCOPE_VIOLATION'
    });
  }
  try {
    let query = `
      SELECT 
        o.override_id,
        o.sku_id,
        p.sku_name,
        o.branch_id,
        o.forecast_date,
        o.original_forecast,
        o.override_quantity,
        o.reason_code,
        o.user_id,
        o.created_at,
        COALESCE(d.total_quantity, NULL) as actual_demand,
        (o.override_quantity - o.original_forecast) as adjustment_delta,
        CASE 
          WHEN d.total_quantity IS NOT NULL THEN
            ABS(o.override_quantity - d.total_quantity) - ABS(o.original_forecast - d.total_quantity)
          ELSE NULL 
        END as human_error_delta
      FROM public.forecast_overrides o
      JOIN public.products p ON o.sku_id = p.sku_id
      LEFT JOIN ml.daily_demand_base d 
        ON o.sku_id = d.sku_id 
        AND o.branch_id = d.branch_id 
        AND o.forecast_date = d.business_date
    `;

    const params: any[] = [];
    if (branchId) {
      query += ` WHERE o.branch_id = $1`;
      params.push(branchId);
    }
    query += ` ORDER BY o.created_at DESC LIMIT 100;`;

    const { rows } = await pool.query(query, params);
    return res.json({
      total_overrides: rows.length,
      records: rows
    });
  } catch (error) {
    console.error('[OVERRIDES] Error fetching analytics:', error);
    return res.status(500).json({ error: 'Failed to fetch override analytics' });
  }
});
