const { Pool } = require('pg');
const logger = require('../utils/logger');

const poolConfig = process.env.DATABASE_URL 
? { 
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  }
: {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'hospital-dms',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  min: parseInt(process.env.DB_POOL_MIN || '2'),
  max: parseInt(process.env.DB_POOL_MAX || '20'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 20000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

const pool = new Pool(poolConfig);

pool.on('connect', (client) => {
  client.query("SET timezone = 'UTC'");
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL pool error', { error: err.message });
});

/**
 * Execute a query with automatic connection management
 */
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn('Slow query detected', { text: text.substring(0, 100), duration });
    }
    return res;
  } catch (err) {
    logger.error('Database query error', { error: err.message, query: text.substring(0, 100) });
    throw err;
  }
};

/**
 * Execute queries within a transaction
 */
const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Health check for DB
 */
const healthCheck = async () => {
  const res = await query('SELECT NOW() as time, version() as version');
  return {
    status: 'healthy',
    timestamp: res.rows[0].time,
    poolTotal: pool.totalCount,
    poolIdle: pool.idleCount,
    poolWaiting: pool.waitingCount,
  };
};

module.exports = { query, withTransaction, healthCheck, pool };