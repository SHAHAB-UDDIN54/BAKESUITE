import { Router, Request, Response } from 'express';
import { testDatabaseConnection } from '../db/index.js';
import { config } from '../config/index.js';
import { formatPKR, formatDatePK } from '../utils/formatters.js';

export const healthRouter = Router();

healthRouter.get('/health', async (req: Request, res: Response) => {
  const dbHealthy = await testDatabaseConnection();
  const now = new Date();

  res.status(dbHealthy ? 200 : 503).json({
    status: dbHealthy ? 'healthy' : 'degraded',
    service: 'bakesuite-erp-core',
    version: '1.0.0',
    timestamp: now.toISOString(),
    regional: {
      currentTimePK: formatDatePK(now),
      timezone: config.regional.timezone,
      currencySample: formatPKR(1250000),
    },
    database: {
      connected: dbHealthy,
      schema: 'public',
    }
  });
});
