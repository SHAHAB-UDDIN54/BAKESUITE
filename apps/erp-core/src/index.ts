import app from './app.js';
import { config } from './config/index.js';
import { testDatabaseConnection } from './db/index.js';

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

bootstrap();

export default app;
