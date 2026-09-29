import { Router, Request, Response } from 'express';
import { pool } from '../db/index.js';
import { authenticateUser, verifyBranchAccess } from '../auth/authMiddleware.js';
import { getKarachiBusinessDate } from '../utils/dateUtils.js';

export const downstreamRouter = Router();

// =========================================================================
// MODULE 1: BRANCH INDENT PLAN (Persistent Storage & Real Approval)
// =========================================================================

/**
 * GET /api/v1/erp/indents
 * Fetches real branch indents for a branch and date.
 * If indents have not yet been generated for that date, generates them from the latest forecast.
 */
downstreamRouter.get('/erp/indents', authenticateUser, async (req: Request, res: Response) => {
  const branchId = (req.query.branch_id as string) || 'BR-KHI-01';
  const indentDate = (req.query.indent_date as string) || (req.query.date as string) || getKarachiBusinessDate();

  if (!verifyBranchAccess(req.user, branchId)) {
    return res.status(403).json({
      error: `Access Denied: User is not authorized for branch ${branchId}`,
      authorized_branches: req.user?.authorizedBranches || []
    });
  }

  try {
    // 1. Check if indents already exist in public.branch_indents
    const existing = await pool.query(`
      SELECT 
        bi.indent_id,
        bi.branch_id,
        bi.sku_id,
        p.sku_name,
        p.category_id,
        p.base_price,
        bi.indent_date,
        COALESCE(fo.override_quantity, bi.p50_demand) as p50_demand,
        CASE 
          WHEN bi.status = 'Approved' THEN bi.suggested_qty
          WHEN fo.override_quantity IS NOT NULL THEN fo.override_quantity
          ELSE bi.suggested_qty 
        END as suggested_qty,
        CASE
          WHEN bi.status = 'Approved' THEN bi.approved_qty
          WHEN fo.override_quantity IS NOT NULL THEN fo.override_quantity
          ELSE bi.approved_qty
        END as approved_qty,
        bi.safety_buffer,
        bi.status,
        bi.approved_by,
        bi.approved_at,
        bi.notes
      FROM public.branch_indents bi
      JOIN public.products p ON bi.sku_id = p.sku_id
      LEFT JOIN LATERAL (
        SELECT override_quantity 
        FROM public.forecast_overrides 
        WHERE branch_id = bi.branch_id AND sku_id = bi.sku_id AND forecast_date = bi.indent_date AND reason_code != 'REVERT_TO_AI'
        ORDER BY created_at DESC LIMIT 1
      ) fo ON true
      WHERE bi.branch_id = $1 AND bi.indent_date = $2
      ORDER BY bi.sku_id ASC;
    `, [branchId, indentDate]);

    if (existing.rows.length > 0) {
      return res.json({
        status: 'SUCCESS',
        branch_id: branchId,
        indent_date: indentDate,
        indents: existing.rows.map(r => ({
          ...r,
          forecast_available: r.p50_demand !== null
        }))
      });
    }

    // 2. If not generated yet, compute initial indents from latest real P50 forecast or override (no fake 45)
    const forecastRows = await pool.query(`
      SELECT 
        p.sku_id,
        p.sku_name,
        p.category_id,
        p.base_price,
        COALESCE(fo.override_quantity, pd.p50_quantity) as p50_qty,
        fo.override_quantity
      FROM public.products p
      LEFT JOIN ml.pred_demand_daily pd ON p.sku_id = pd.sku_id AND pd.branch_id = $1 AND pd.forecast_date = $2
      LEFT JOIN LATERAL (
        SELECT override_quantity 
        FROM public.forecast_overrides 
        WHERE branch_id = $1 AND sku_id = p.sku_id AND forecast_date = $2 AND reason_code != 'REVERT_TO_AI'
        ORDER BY created_at DESC LIMIT 1
      ) fo ON true
      WHERE p.status = 'ACTIVE'
      ORDER BY p.sku_id ASC;
    `, [branchId, indentDate]);

    const initialIndents = [];
    for (const r of forecastRows.rows) {
      if (r.p50_qty === null || r.p50_qty === undefined) {
        initialIndents.push({
          branch_id: branchId,
          sku_id: r.sku_id,
          sku_name: r.sku_name,
          category_id: r.category_id,
          base_price: r.base_price,
          indent_date: indentDate,
          forecast_available: false,
          p50_demand: null,
          suggested_qty: null,
          approved_qty: null,
          safety_buffer: null,
          status: 'FORECAST_UNAVAILABLE'
        });
        continue;
      }

      const p50 = parseInt(r.p50_qty, 10);
      const isOverridden = r.override_quantity !== null && r.override_quantity !== undefined;
      const buffer = isOverridden ? 0 : Math.max(1, Math.round(p50 * 0.15));
      const suggested = isOverridden ? parseInt(r.override_quantity, 10) : (p50 + buffer);

      const inserted = await pool.query(`
        INSERT INTO public.branch_indents (
          branch_id, sku_id, indent_date, p50_demand, suggested_qty, approved_qty, safety_buffer, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending Approval')
        ON CONFLICT (branch_id, sku_id, indent_date) DO UPDATE SET
          p50_demand = EXCLUDED.p50_demand,
          suggested_qty = EXCLUDED.suggested_qty
        RETURNING *;
      `, [branchId, r.sku_id, indentDate, p50, suggested, suggested, buffer]);

      initialIndents.push({
        ...inserted.rows[0],
        forecast_available: true,
        sku_name: r.sku_name,
        category_id: r.category_id,
        base_price: r.base_price
      });
    }

    return res.json({
      status: 'INITIALIZED',
      branch_id: branchId,
      indent_date: indentDate,
      indents: initialIndents
    });
  } catch (error: any) {
    console.error('[DOWNSTREAM] Indent fetch error:', error);
    return res.status(500).json({ error: error.message || 'Failed to fetch branch indents' });
  }
});

/**
 * POST /api/v1/erp/indents/approve
 * Persists approval for a single SKU indent with user audit trail.
 */
downstreamRouter.post('/erp/indents/approve', authenticateUser, async (req: Request, res: Response) => {
  let { indent_id, branch_id, sku_id, indent_date, approved_qty, notes, status } = req.body;
  const user = req.user?.userId || 'branch-manager';
  const newStatus = status || 'Approved';

  if (!indent_id && (!branch_id || !sku_id)) {
    return res.status(400).json({ error: 'Missing required indent approval fields (indent_id or branch_id + sku_id)' });
  }

  if (branch_id && !verifyBranchAccess(req.user, branch_id)) {
    return res.status(403).json({
      error: `Access Denied: User is not authorized for branch ${branch_id}`,
      authorized_branches: req.user?.authorizedBranches || []
    });
  }

  try {
    let result;
    const isNumericIndent = indent_id !== undefined && indent_id !== null && !isNaN(Number(indent_id)) && String(indent_id).trim() !== '';
    if (isNumericIndent) {
      result = await pool.query(`
        UPDATE public.branch_indents
        SET 
          approved_qty = COALESCE($1, approved_qty),
          status = $2,
          approved_by = $3,
          approved_at = CURRENT_TIMESTAMP,
          notes = COALESCE($4, notes),
          updated_at = CURRENT_TIMESTAMP
        WHERE indent_id = $5
        RETURNING *;
      `, [approved_qty !== undefined ? parseInt(approved_qty, 10) : null, newStatus, user, notes, Number(indent_id)]);
    } else {
      const iDate = indent_date || getKarachiBusinessDate();
      result = await pool.query(`
        UPDATE public.branch_indents
        SET 
          approved_qty = COALESCE($1, approved_qty),
          status = $2,
          approved_by = $3,
          approved_at = CURRENT_TIMESTAMP,
          notes = COALESCE($4, notes),
          updated_at = CURRENT_TIMESTAMP
        WHERE branch_id = $5 AND sku_id = $6 AND indent_date = $7
        RETURNING *;
      `, [approved_qty !== undefined ? parseInt(approved_qty, 10) : null, newStatus, user, notes, branch_id || 'BR-KHI-01', sku_id, iDate]);
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Indent record not found' });
    }

    return res.json({
      status: 'SUCCESS',
      indent: result.rows[0],
      approved_qty: result.rows[0].approved_qty
    });
  } catch (error: any) {
    console.error('[DOWNSTREAM] Indent approval error:', error);
    return res.status(500).json({ error: error.message || 'Failed to approve indent' });
  }
});

/**
 * POST /api/v1/erp/indents/approve-all
 * Batch approves all pending indents for a branch and date.
 */
downstreamRouter.post('/erp/indents/approve-all', authenticateUser, async (req: Request, res: Response) => {
  const { branch_id, indent_date } = req.body;
  const user = req.user?.userId || 'branch-manager';

  if (!branch_id || !indent_date) {
    return res.status(400).json({ error: 'Missing branch_id or indent_date' });
  }

  if (!verifyBranchAccess(req.user, branch_id)) {
    return res.status(403).json({
      error: `Access Denied: User is not authorized for branch ${branch_id}`,
      authorized_branches: req.user?.authorizedBranches || []
    });
  }

  try {
    const result = await pool.query(`
      UPDATE public.branch_indents
      SET 
        status = 'Approved',
        approved_by = $1,
        approved_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE branch_id = $2 AND indent_date = $3 AND status != 'Approved'
      RETURNING indent_id;
    `, [user, branch_id, indent_date]);

    return res.json({
      status: 'SUCCESS',
      approved_count: result.rowCount
    });
  } catch (error: any) {
    console.error('[DOWNSTREAM] Approve-all indents error:', error);
    return res.status(500).json({ error: error.message || 'Failed to approve indents' });
  }
});


// =========================================================================
// MODULE 2: CENTRAL KITCHEN BAKE PLAN (Equipment & Capacity Driven)
// =========================================================================

/**
 * GET /api/v1/erp/production-plans
 * Fetches real production bake plan calculated from approved indents & available equipment.
 * Removes fake fallback 50 (Task 8). If no demand exists, returns explicit status.
 */
downstreamRouter.get('/erp/production-plans', authenticateUser, async (req: Request, res: Response) => {
  const branchId = (req.query.branch_id as string) || 'BR-KHI-01';
  const prodDate = (req.query.production_date as string) || getKarachiBusinessDate();

  if (!verifyBranchAccess(req.user, branchId)) {
    return res.status(403).json({
      error: `Access Denied: User is not authorized for branch ${branchId}`,
      authorized_branches: req.user?.authorizedBranches || []
    });
  }

  try {
    // 1. Fetch available production equipment for branch
    const eqRows = await pool.query(`
      SELECT equipment_id, equipment_name, equipment_type, capacity_units_per_batch, batch_duration_minutes, status
      FROM public.production_equipment
      WHERE branch_id = $1 AND status = 'AVAILABLE'
      ORDER BY capacity_units_per_batch DESC;
    `, [branchId]);

    // 2. Fetch real quantities strictly from approved indents or suggested indents (no fake 50)
    const demandRows = await pool.query(`
      SELECT 
        p.sku_id,
        p.sku_name,
        p.category_id,
        COALESCE(bi.approved_qty, bi.suggested_qty) as target_qty
      FROM public.products p
      LEFT JOIN public.branch_indents bi ON p.sku_id = bi.sku_id AND bi.branch_id = $1 AND bi.indent_date = $2
      WHERE p.status = 'ACTIVE'
      ORDER BY p.category_id, p.sku_id;
    `, [branchId, prodDate]);

    // 3. Map demand to equipment and calculate batch count
    const defaultDeckOven = eqRows.rows.find((e: any) => e.equipment_type.includes('Deck')) || eqRows.rows[0];
    const defaultRackOven = eqRows.rows.find((e: any) => e.equipment_type.includes('Rotary')) || eqRows.rows[0];

    const bakePlan = demandRows.rows.map((d: any) => {
      const isBread = d.category_id === 'BREAD';
      const eq = isBread ? (defaultRackOven || defaultDeckOven) : defaultDeckOven;
      const cap = eq ? eq.capacity_units_per_batch : 60;
      
      const hasDemand = d.target_qty !== null && d.target_qty !== undefined;
      const target = hasDemand ? parseInt(d.target_qty, 10) : null;
      const batches = (target !== null && target > 0) ? Math.max(1, Math.ceil(target / cap)) : 0;
      const scheduled = batches * cap;

      return {
        sku_id: d.sku_id,
        sku_name: d.sku_name,
        category_id: d.category_id,
        target_demand_qty: target,
        equipment_id: eq ? eq.equipment_id : 'EQ-GEN-01',
        equipment_name: eq ? eq.equipment_name : 'Commercial Deck Oven',
        equipment_type: eq ? eq.equipment_type : 'Oven',
        capacity_per_batch: cap,
        batches_required: batches,
        scheduled_production_qty: scheduled,
        status: hasDemand ? (target! > 0 ? 'SCHEDULED' : 'ZERO_DEMAND') : 'NO_PRODUCTION_QUANTITY'
      };
    });

    return res.json({
      status: 'SUCCESS',
      branch_id: branchId,
      production_date: prodDate,
      equipment_count: eqRows.rows.length,
      plan: bakePlan
    });
  } catch (error: any) {
    console.error('[DOWNSTREAM] Production plan fetch error:', error);
    return res.status(500).json({ error: error.message || 'Failed to fetch production plan' });
  }
});

/**
 * POST /api/v1/erp/production-plans/emergency-batch
 * Persists an emergency production batch into public.production_plans.
 */
downstreamRouter.post('/erp/production-plans/emergency-batch', authenticateUser, async (req: Request, res: Response) => {
  const branch_id = req.body.branch_id || 'BR-KHI-01';
  const sku_id = req.body.sku_id;
  const production_date = req.body.production_date || getKarachiBusinessDate();
  const shift_name = req.body.shift_name || req.body.shift || 'Emergency Shift';
  const user = req.user?.userId || 'baking-supervisor';

  if (!sku_id) {
    return res.status(400).json({ error: 'Missing emergency batch SKU ID' });
  }

  if (branch_id && !verifyBranchAccess(req.user, branch_id)) {
    return res.status(403).json({
      error: `Access Denied: User is not authorized for branch ${branch_id}`,
      authorized_branches: req.user?.authorizedBranches || []
    });
  }

  try {
    // Determine equipment capacity
    const eqRes = await pool.query(`
      SELECT equipment_id, equipment_name, capacity_units_per_batch
      FROM public.production_equipment
      WHERE branch_id = $1 AND status = 'AVAILABLE'
      LIMIT 1;
    `, [branch_id]);

    const eqId = eqRes.rows[0]?.equipment_id || 'EQ-OVEN-01';
    const eqName = eqRes.rows[0]?.equipment_name || 'Rotary Rack 1';
    const cap = eqRes.rows[0]?.capacity_units_per_batch || 50;

    let batchCount = 1;
    if (req.body.batches) {
      batchCount = Math.max(1, parseInt(req.body.batches, 10));
    } else if (req.body.quantity) {
      batchCount = Math.max(1, Math.ceil(parseInt(req.body.quantity, 10) / cap));
    }
    const scheduledQty = req.body.quantity ? parseInt(req.body.quantity, 10) : (batchCount * cap);

    const result = await pool.query(`
      INSERT INTO public.production_plans (
        branch_id, sku_id, production_date, shift_name, equipment_id, batch_count, scheduled_qty, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'EMERGENCY_SCHEDULED', $8)
      RETURNING *;
    `, [branch_id, sku_id, production_date, shift_name, eqId, batchCount, scheduledQty, user]);

    return res.json({
      status: 'SUCCESS',
      message: `Emergency batch scheduled: ${batchCount} batches (${scheduledQty} units)`,
      plan_id: result.rows[0].plan_id,
      equipment_name: eqName,
      is_emergency: true,
      plan: result.rows[0]
    });
  } catch (error: any) {
    console.error('[DOWNSTREAM] Emergency batch schedule error:', error);
    return res.status(500).json({ error: error.message || 'Failed to schedule emergency batch' });
  }
});


// =========================================================================
// MODULE 3: PURCHASE REQUIREMENTS & BOM EXPLOSION
// =========================================================================

/**
 * GET /api/v1/erp/purchase-requirements
 * Executes real Bill of Materials (BOM) explosion:
 * Gross Requirement = Sum(Production Plan Qty * Recipe Quantity)
 * Net Requirement = max(0, Gross Requirement - Available Stock - Incoming Stock + Safety Stock)
 * Removes fake fallback 50 (Task 8). If no demand exists, returns explicit status.
 */
downstreamRouter.get('/erp/purchase-requirements', authenticateUser, async (req: Request, res: Response) => {
  const branchId = (req.query.branch_id as string) || 'BR-KHI-01';
  const orderDate = (req.query.order_date as string) || getKarachiBusinessDate();

  if (!verifyBranchAccess(req.user, branchId)) {
    return res.status(403).json({
      error: `Access Denied: User is not authorized for branch ${branchId}`,
      authorized_branches: req.user?.authorizedBranches || []
    });
  }

  try {
    // 1. Fetch all raw inventory records
    const invRows = await pool.query(`
      SELECT material_name, available_stock, safety_stock, incoming_stock, unit, unit_cost_pkr, supplier_name
      FROM public.raw_inventory
      ORDER BY material_name ASC;
    `);

    // 2. Fetch gross requirements by joining real indents with recipes (no fake 50 fallback)
    const grossRows = await pool.query(`
      SELECT 
        r.ingredient_name,
        r.unit,
        r.unit_cost_pkr,
        r.supplier_name,
        SUM(COALESCE(bi.approved_qty, bi.suggested_qty) * r.quantity_per_sku) as gross_qty
      FROM public.recipes r
      JOIN public.products p ON r.sku_id = p.sku_id
      JOIN public.branch_indents bi ON p.sku_id = bi.sku_id AND bi.branch_id = $1 AND bi.indent_date = $2
      WHERE (bi.approved_qty IS NOT NULL OR bi.suggested_qty IS NOT NULL)
      GROUP BY r.ingredient_name, r.unit, r.unit_cost_pkr, r.supplier_name;
    `, [branchId, orderDate]);

    const grossMap = new Map<string, number>();
    for (const g of grossRows.rows) {
      if (g.gross_qty !== null && g.gross_qty !== undefined) {
        grossMap.set(g.ingredient_name, parseFloat(g.gross_qty));
      }
    }

    const hasProductionQuantity = grossRows.rows.length > 0;

    // 3. Compute net requirement = max(0, gross - available - incoming + safety)
    const requirements = invRows.rows.map((inv: any) => {
      const avail = parseFloat(inv.available_stock);
      const incoming = parseFloat(inv.incoming_stock);
      const safety = parseFloat(inv.safety_stock);
      const unitCost = inv.unit_cost_pkr != null ? parseFloat(inv.unit_cost_pkr) : null;

      if (!hasProductionQuantity || !grossMap.has(inv.material_name)) {
        return {
          material_name: inv.material_name,
          gross_requirement: hasProductionQuantity ? 0 : null,
          available_stock: avail,
          incoming_stock: incoming,
          safety_stock: safety,
          net_shortfall: null,
          unit: inv.unit,
          unit_cost_pkr: unitCost,
          estimated_cost_pkr: null,
          supplier_name: inv.supplier_name,
          status: hasProductionQuantity ? 'No Material Demand' : 'NO_PRODUCTION_QUANTITY'
        };
      }

      const gross = grossMap.get(inv.material_name) || 0.0;
      const netShortfall = Math.max(0, Math.round((gross - avail - incoming + safety) * 100) / 100);
      const estCost = unitCost !== null ? Math.round(netShortfall * unitCost) : null;

      return {
        material_name: inv.material_name,
        gross_requirement: Math.round(gross * 10) / 10,
        available_stock: avail,
        incoming_stock: incoming,
        safety_stock: safety,
        net_shortfall: netShortfall,
        unit: inv.unit,
        unit_cost_pkr: unitCost,
        estimated_cost_pkr: estCost,
        supplier_name: inv.supplier_name,
        status: netShortfall > 0 ? 'Shortage Detected' : 'Sufficient Stock'
      };
    });

    return res.json({
      status: hasProductionQuantity ? 'SUCCESS' : 'DATA_REQUIRED',
      order_date: orderDate,
      branch_id: branchId,
      materials: requirements
    });
  } catch (error: any) {
    console.error('[DOWNSTREAM] Purchase requirements error:', error);
    return res.status(500).json({ error: error.message || 'Failed to compute purchase requirements' });
  }
});

/**
 * POST /api/v1/erp/purchase-orders
 * Issues and persists a real purchase order into public.purchase_orders.
 * Strictly requires real supplier name (Task 9) and verified unit cost (Task 10).
 */
downstreamRouter.post('/erp/purchase-orders', authenticateUser, async (req: Request, res: Response) => {
  const material_name = req.body.material_name || req.body.material_id;
  const required_qty = req.body.required_qty || req.body.quantity;
  const unit = req.body.unit || req.body.unit_of_measure || 'KG';
  const supplier_name = req.body.supplier_name || req.body.supplier;
  const unit_cost_pkr = req.body.unit_cost_pkr !== undefined ? req.body.unit_cost_pkr : req.body.unit_price;
  const order_date = req.body.order_date;
  const notes = req.body.notes;
  const user = req.user?.userId || 'procurement-manager';

  if (!material_name || !required_qty) {
    return res.status(400).json({ error: 'Missing required purchase order fields (material_name, quantity)' });
  }

  // Task 9: Require real supplier name (no fake 'Approved Supplier')
  if (!supplier_name || typeof supplier_name !== 'string' || supplier_name.trim() === '' || supplier_name === 'Approved Supplier') {
    return res.status(422).json({
      error: 'supplier_required: A verified, valid supplier name must be provided',
      field: 'supplier_name'
    });
  }

  // Task 10: Require actual supplier price (no fake 150 PKR)
  if (unit_cost_pkr === undefined || unit_cost_pkr === null || isNaN(parseFloat(unit_cost_pkr)) || parseFloat(unit_cost_pkr) <= 0) {
    return res.status(422).json({
      error: 'unit_cost_required: Actual supplier unit price is required to issue purchase order',
      field: 'unit_cost_pkr'
    });
  }

  const dateStr = order_date || getKarachiBusinessDate();
  const dateCompact = dateStr.replace(/-/g, '');
  const poId = `PO-${dateCompact}-${Math.floor(1000 + Math.random() * 9000)}`;
  const qty = parseFloat(required_qty);
  const cost = parseFloat(unit_cost_pkr);
  const total = Math.round(qty * cost * 100) / 100;

  try {
    const result = await pool.query(`
      INSERT INTO public.purchase_orders (
        po_id, supplier_name, material_name, order_date, required_qty, unit, unit_cost_pkr, total_amount_pkr, status, issued_by, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'APPROVED', $9, $10)
      RETURNING *;
    `, [poId, supplier_name.trim(), material_name, dateStr, qty, unit, cost, total, user, notes]);

    return res.json({
      status: 'APPROVED',
      po_number: poId,
      message: `Purchase Order ${poId} issued successfully for ${qty} ${unit} of ${material_name}`,
      purchase_order: result.rows[0]
    });
  } catch (error: any) {
    console.error('[DOWNSTREAM] Issue PO error:', error);
    return res.status(500).json({ error: error.message || 'Failed to issue purchase order' });
  }
});
