import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:@localhost:5432/bakesuite',
  mlServiceUrl: process.env.ML_SERVICE_URL || 'http://localhost:8000',
  regional: {
    currency: 'PKR',
    currencyPrefix: 'Rs',
    timezone: 'Asia/Karachi',
    dateFormat: 'DD-MM-YYYY',
    fiscalYearStartMonth: 7, // 1 July
  }
};
