import { Router, Request, Response } from 'express';
import { pool } from '../db/index.js';

export const extractsRouter = Router();

/**
 * Phase 4: ERP Extraction Surface
 * Watermark-driven, cursor-paginated NDJSON streams.
 * Strict Isolation: Exposes transactional data to ML ETL without ML direct DB connection.
 */

// 1. Invoices & Invoice Lines Extract (NDJSON stream)
extractsRouter.get('/invoices', async (req: Request, res: Response) => {
  const since = req.query.since_timestamp ? new Date(req.query.since_timestamp as string) : new Date(0);
  const limit = Math.min(parseInt(req.query.limit as string || '1000', 10), 50000);
  const cursor = parseInt(req.query.cursor as string || '0', 10);

  try {
    const query = `
      SELECT 
        i.invoice_id,
        i.branch_id,
        i.business_date,
        i.invoice_timestamp,
        i.channel,
        i.total_net_amount,
        l.line_id,
        l.sku_id,
        l.quantity,
        l.unit_price,
        l.net_amount
      FROM public.pos_invoices i
      JOIN public.pos_invoice_lines l ON i.invoice_id = l.invoice_id
      WHERE i.invoice_timestamp >= $1 AND l.line_id > $2
      ORDER BY l.line_id ASC
      LIMIT $3;
    `;

    const { rows } = await pool.query(query, [since.toISOString(), cursor, limit]);

    // Stream NDJSON response
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('X-Records-Count', rows.length.toString());
    const nextCursor = rows.length > 0 ? rows[rows.length - 1].line_id : null;
    if (nextCursor) {
      res.setHeader('X-Next-Cursor', nextCursor.toString());
    }

    for (const row of rows) {
      res.write(JSON.stringify(row) + '\n');
    }
    res.end();
  } catch (error) {
    console.error('[EXTRACTS] Invoices extract error:', error);
    res.status(500).json({ error: 'Failed to extract invoice stream' });
  }
});

// 2. Product Master Catalog Extract
extractsRouter.get('/products', async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT sku_id, sku_name, category_id, shelf_life_hours, base_price, status, launch_date
      FROM public.products
      ORDER BY sku_id ASC;
    `);

    res.setHeader('Content-Type', 'application/x-ndjson');
    for (const row of rows) {
      res.write(JSON.stringify(row) + '\n');
    }
    res.end();
  } catch (error) {
    console.error('[EXTRACTS] Products extract error:', error);
    res.status(500).json({ error: 'Failed to extract product catalog' });
  }
});

// 3. Branches Directory Extract
extractsRouter.get('/branches', async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT branch_id, branch_name, city, area_type, opening_hours, open_date
      FROM public.branches
      ORDER BY branch_id ASC;
    `);

    res.setHeader('Content-Type', 'application/x-ndjson');
    for (const row of rows) {
      res.write(JSON.stringify(row) + '\n');
    }
    res.end();
  } catch (error) {
    console.error('[EXTRACTS] Branches extract error:', error);
    res.status(500).json({ error: 'Failed to extract branches' });
  }
});

// 4. Regional Price Lists Extract
extractsRouter.get('/prices', async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT sku_id, branch_id, effective_price, effective_from
      FROM public.price_lists
      ORDER BY branch_id, sku_id ASC;
    `);

    res.setHeader('Content-Type', 'application/x-ndjson');
    for (const row of rows) {
      res.write(JSON.stringify(row) + '\n');
    }
    res.end();
  } catch (error) {
    console.error('[EXTRACTS] Prices extract error:', error);
    res.status(500).json({ error: 'Failed to extract price lists' });
  }
});

// 5. Active Promotions & Redemptions Extract
extractsRouter.get('/promotions', async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.promotion_id, p.sku_id, p.branch_id, p.discount_percent, p.start_date, p.end_date,
             COALESCE(SUM(r.quantity_redeemed), 0) as total_redemptions
      FROM public.promotions p
      LEFT JOIN public.promotion_redemptions r ON p.promotion_id = r.promotion_id
      GROUP BY p.promotion_id, p.sku_id, p.branch_id, p.discount_percent, p.start_date, p.end_date
      ORDER BY p.start_date DESC;
    `);

    res.setHeader('Content-Type', 'application/x-ndjson');
    for (const row of rows) {
      res.write(JSON.stringify(row) + '\n');
    }
    res.end();
  } catch (error) {
    console.error('[EXTRACTS] Promotions extract error:', error);
    res.status(500).json({ error: 'Failed to extract promotions' });
  }
});

// 6. Stock Movements & Inventory Extract
extractsRouter.get('/stock-movements', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string || '5000', 10), 50000);
  try {
    const { rows } = await pool.query(`
      SELECT movement_id, sku_id, branch_id, movement_date, on_hand_close, stockout_minutes
      FROM public.stock_movements
      ORDER BY movement_date DESC, movement_id DESC
      LIMIT $1;
    `, [limit]);

    res.setHeader('Content-Type', 'application/x-ndjson');
    for (const row of rows) {
      res.write(JSON.stringify(row) + '\n');
    }
    res.end();
  } catch (error) {
    console.error('[EXTRACTS] Stock movements extract error:', error);
    res.status(500).json({ error: 'Failed to extract stock movements' });
  }
});

// 7. Waste & Shrinkage Records Extract
extractsRouter.get('/waste-records', async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT waste_id, sku_id, branch_id, waste_date, waste_quantity, reason_code
      FROM public.waste_records
      ORDER BY waste_date DESC;
    `);

    res.setHeader('Content-Type', 'application/x-ndjson');
    for (const row of rows) {
      res.write(JSON.stringify(row) + '\n');
    }
    res.end();
  } catch (error) {
    console.error('[EXTRACTS] Waste records extract error:', error);
    res.status(500).json({ error: 'Failed to extract waste records' });
  }
});
