import express from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import { healthRouter } from './routes/health.js';
import { extractsRouter } from './routes/extracts.js';
import { forecastsRouter } from './routes/forecasts.js';
import { overridesRouter } from './routes/overrides.js';
import { testDatabaseConnection } from './db/index.js';

const app = express();

app.use(cors());
app.use(express.json());

// Register API Routes
app.use('/api/v1', healthRouter);
app.use('/api/v1/ai/extracts', extractsRouter);
app.use('/api/v1/ai', forecastsRouter);
app.use('/api/v1/ai', overridesRouter);

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static Forecast Workbench UI assets
const clientPath = path.join(__dirname, '../client');
app.use(express.static(clientPath));

// Root serves Forecast Workbench UI
app.get('/', (req, res) => {
  res.sendFile(path.join(clientPath, 'index.html'));
});

async function bootstrap() {
  console.log('----------------------------------------------------');
  console.log('Starting BakeSuite ERP Core...');
  console.log(`Timezone: ${config.regional.timezone}`);
  console.log(`Currency Convention: ${config.regional.currencyPrefix} 1,250,000.00`);
  
  await testDatabaseConnection();

  app.listen(config.port, () => {
    console.log(`[ERP-CORE] Running at http://localhost:${config.port}`);
    console.log(`[ERP-CORE] Health check at http://localhost:${config.port}/api/v1/health`);
    console.log('----------------------------------------------------');
  });
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}

export default app;
