import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:@localhost:5432/bakesuite',
  mlServiceUrl: process.env.ML_SERVICE_URL || 'http://localhost:8000',
  jwtSecret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'bakesuite-default-dev-secret-do-not-use-in-prod-2026'),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5500,http://127.0.0.1:5500,http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map(o => o.trim()),
  regional: {
    currency: 'PKR',
    currencyPrefix: 'Rs',
    timezone: 'Asia/Karachi',
    dateFormat: 'DD-MM-YYYY',
    fiscalYearStartMonth: 7, // 1 July
  }
};
