'use strict';

/**
 * server.js
 *
 * Application entry point.
 *
 * Responsibilities:
 *   1. Validate critical environment variables before starting
 *   2. Establish database connection
 *   3. Start the HTTP server
 *   4. Handle graceful shutdown on SIGTERM / SIGINT
 *
 * This file does NOT define routes or middleware — that lives in app.js.
 * Keeping startup logic separate from app configuration enables clean testing.
 */

require('dotenv').config();

const app = require('./app');
const { connectDB, closeDB } = require('./config/db');

const PORT = parseInt(process.env.PORT || '5000', 10);

// ── Environment variable validation ──────────────────────────
// Fail loudly at startup rather than silently at runtime.
// This prevents a server from starting with a misconfigured JWT secret
// and then issuing tokens that can't be verified (or verified by anyone
// who knows the default value).

const REQUIRED_ENV = {
  DATABASE_URL:
    'PostgreSQL connection string. Railway provides this automatically. For local dev, see .env.example.',
  JWT_SECRET:
    'A minimum 64-character cryptographic secret. Generate with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"',
};

// DB_HOST+DB_NAME is an alternative to DATABASE_URL for local dev.
const hasDbUrl = Boolean(process.env.DATABASE_URL);
const hasDbParts = Boolean(process.env.DB_HOST && process.env.DB_NAME);

const missingVars = [];

if (!hasDbUrl && !hasDbParts) {
  missingVars.push('DATABASE_URL (or DB_HOST + DB_NAME + DB_USER + DB_PASSWORD)');
}

if (!process.env.JWT_SECRET) {
  missingVars.push('JWT_SECRET');
} else if (process.env.JWT_SECRET.length < 32) {
  // Warn but don't block — allows quick local dev with short secrets.
  // In production, enforce a minimum length.
  if (process.env.NODE_ENV === 'production') {
    missingVars.push('JWT_SECRET (must be at least 64 characters in production)');
  } else {
    console.warn('[Server] WARNING: JWT_SECRET is shorter than recommended (32 chars min). Use a 64+ char secret in production.');
  }
}

if (missingVars.length > 0) {
  console.error('');
  console.error('═══════════════════════════════════════════════════');
  console.error('  STARTUP FAILED — Missing required environment variables:');
  missingVars.forEach((v) => console.error(`  ✗ ${v}`));
  console.error('');
  console.error('  Copy .env.example to .env and fill in the values.');
  console.error('  See README.md for setup instructions.');
  console.error('═══════════════════════════════════════════════════');
  console.error('');
  process.exit(1);
}

// ── Server startup ─────────────────────────────────────────────

let server;

async function start() {
  console.log('');
  console.log('┌────────────────────────────────────────────┐');
  console.log('│  The Green Acre — API Server               │');
  console.log('│  Private Farmhouse Booking Platform        │');
  console.log('└────────────────────────────────────────────┘');
  console.log('');
  console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[Server] Port: ${PORT}`);

  // 1. Connect to database first — fail fast if DB is unreachable.
  await connectDB();

  // 2. Start HTTP server.
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Listening on http://0.0.0.0:${PORT}`);
    console.log(`[Server] Health check: http://0.0.0.0:${PORT}/health`);
    console.log('[Server] Ready.');
    console.log('');
  });

  // Handle HTTP server errors (e.g. port already in use).
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Server] Port ${PORT} is already in use. Choose a different PORT in .env.`);
    } else {
      console.error('[Server] HTTP server error:', err.message);
    }
    process.exit(1);
  });
}

// ── Graceful shutdown ─────────────────────────────────────────
// Railway sends SIGTERM before stopping a service.
// We close the HTTP server first (stop accepting new connections),
// then close the DB pool (allow in-flight queries to complete).

async function shutdown(signal) {
  console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);

  if (server) {
    server.close(async () => {
      console.log('[Server] HTTP server closed.');
      await closeDB();
      console.log('[Server] Shutdown complete.');
      process.exit(0);
    });

    // Force shutdown after 10 seconds if graceful shutdown hangs.
    setTimeout(() => {
      console.error('[Server] Forced shutdown after 10s timeout.');
      process.exit(1);
    }, 10_000);
  } else {
    await closeDB();
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Catch unhandled promise rejections — log and exit.
// Unhandled rejections should never happen in production;
// all async functions use try/catch or pass errors to next().
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled Promise Rejection:', reason);
  process.exit(1);
});

// Catch uncaught exceptions — log and exit.
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err.message);
  console.error(err.stack);
  process.exit(1);
});

// ── Start ──────────────────────────────────────────────────────
start().catch((err) => {
  console.error('[Server] Failed to start:', err.message);
  console.error(err.stack);
  process.exit(1);
});
