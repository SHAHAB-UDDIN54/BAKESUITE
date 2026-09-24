import { Pool } from 'pg';
import { config } from '../config/index.js';

const dbUrl = new URL(config.databaseUrl);
if (!dbUrl.searchParams.has('options')) {
  dbUrl.searchParams.set('options', '-csearch_path=public');
}

export const pool = new Pool({
  connectionString: dbUrl.toString(),
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export async function testDatabaseConnection(): Promise<boolean> {
  try {
    const res = await pool.query('SELECT NOW() as server_time, current_schema() as schema;');
    console.log(`[ERP-DB] Connected to PostgreSQL. Server time: ${res.rows[0].server_time}, Active schema: ${res.rows[0].schema}`);
    return true;
  } catch (error) {
    console.error('[ERP-DB] Database connection error:', error);
    return false;
  }
}
