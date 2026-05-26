'use strict';

/**
 * config/db.js
 *
 * PostgreSQL connection pool.
 * Uses the pg library directly (no ORM).
 *
 * Connection resolution order:
 *   1. DATABASE_URL environment variable (Railway, Heroku, etc.)
 *   2. Individual DB_* environment variables (local dev)
 *
 * All date/time operations are performed in IST (Asia/Kolkata, UTC+5:30)
 * because the property and all guests operate in Indian Standard Time.
 * The pool sets the timezone on every new connection via a post-connect hook.
 */

const { Pool } = require('pg');

/** Build the pool configuration from environment variables. */
function buildPoolConfig() {
  // Railway and most PaaS providers inject DATABASE_URL.
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      // Enforce SSL in production; skip in local dev if not configured.
      ssl:
        process.env.NODE_ENV === 'production'
          ? { rejectUnauthorized: false }
          : false,
      // Pool sizing — conservative defaults suitable for a low-traffic booking platform.
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    };
  }

  // Fallback: individual variables for local development.
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'greenacre',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };
}

const pool = new Pool(buildPoolConfig());

/**
 * Post-connect hook — runs once per physical connection.
 * Sets the session timezone to IST so that PostgreSQL NOW(),
 * CURRENT_DATE, and all timestamp comparisons are IST-aware.
 * This prevents off-by-one date bugs for bookings submitted at
 * night in India (which would be the previous UTC date).
 */
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'Asia/Kolkata'").catch((err) => {
    console.error('[DB] Failed to set session timezone:', err.message);
  });
});

/** Log pool errors that occur outside of a query (e.g. idle client errors). */
pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
  // Do not crash the process — the pool will attempt to recover.
});

/**
 * Verifies the database connection on startup.
 * Throws if the database is unreachable, which prevents the server
 * from accepting requests with a broken DB layer.
 *
 * @returns {Promise<void>}
 */
async function connectDB() {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT NOW() AS now, current_setting($1) AS tz', [
      'TIMEZONE',
    ]);
    console.log(
      `[DB] Connected. Server time: ${result.rows[0].now} | Timezone: ${result.rows[0].tz}`
    );
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    throw err; // Let server.js catch this and exit.
  } finally {
    if (client) client.release();
  }
}

/**
 * Executes a parameterized SQL query against the pool.
 * Always use this function — never execute queries directly on the pool
 * from controllers, to keep connection management centralised.
 *
 * @param {string} text   - Parameterized SQL string (e.g. 'SELECT * FROM t WHERE id = $1')
 * @param {Array}  params - Bound parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'production') {
      // Log slow queries in development for debugging.
      if (duration > 200) {
        console.warn(`[DB] Slow query (${duration}ms):`, text.slice(0, 80));
      }
    }
    return result;
  } catch (err) {
    console.error('[DB] Query error:', { text: text.slice(0, 80), error: err.message });
    throw err;
  }
}

/**
 * Acquires a dedicated client from the pool for transaction use.
 * The caller is responsible for calling client.release() in a finally block.
 *
 * Usage:
 *   const client = await getClient();
 *   try {
 *     await client.query('BEGIN');
 *     ...
 *     await client.query('COMMIT');
 *   } catch (e) {
 *     await client.query('ROLLBACK');
 *     throw e;
 *   } finally {
 *     client.release();
 *   }
 *
 * @returns {Promise<import('pg').PoolClient>}
 */
async function getClient() {
  return pool.connect();
}

/**
 * Gracefully closes all pool connections.
 * Called during process shutdown (SIGTERM / SIGINT).
 *
 * @returns {Promise<void>}
 */
async function closeDB() {
  await pool.end();
  console.log('[DB] Pool closed.');
}

module.exports = { query, getClient, connectDB, closeDB };
