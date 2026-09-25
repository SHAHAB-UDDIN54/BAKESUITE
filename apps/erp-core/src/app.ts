import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { extractsRouter } from './routes/extracts.js';
import { forecastsRouter } from './routes/forecasts.js';
import { overridesRouter } from './routes/overrides.js';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config/index.js';

const app = express();

// Restricted CORS per Requirement 38
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || config.allowedOrigins.includes(origin) || config.allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true
}));
app.use(express.json());

// Register API Routes
app.use('/api/v1', healthRouter);
app.use('/api/v1/ai/extracts', extractsRouter);
app.use('/api/v1/ai', forecastsRouter);
app.use('/api/v1/ai', overridesRouter);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static Forecast Workbench UI assets
const clientPath = path.join(__dirname, '../client');
app.use(express.static(clientPath));

// Root serves Forecast Workbench UI
app.get('/', (req, res) => {
  res.sendFile(path.join(clientPath, 'index.html'));
});

export default app;
