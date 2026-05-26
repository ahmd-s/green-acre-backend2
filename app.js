'use strict';

/**
 * MUST be the very first require — before express is loaded.
 * Monkey-patches Express 4 so that async route handler rejections are
 * forwarded to the global error handler instead of crashing the process.
 * Without this, any unhandled async throw in Express 4 becomes an
 * unhandled rejection that in Node 20 terminates the process.
 */
require('express-async-errors');

/**
 * app.js
 *
 * Express application factory.
 * Creates and configures the Express app — all middleware, CORS, Helmet,
 * route mounting, and error handlers are registered here.
 *
 * Separating app creation from server startup (server.js) enables
 * clean testing without binding to a port.
 *
 * Middleware order (ORDER IS CRITICAL — do not rearrange):
 *   1. trust proxy        — must come first so rate limiters and logs get real IPs
 *   2. helmet             — security headers on ALL responses
 *   3. cors               — handle preflight and CORS headers before any processing
 *   4. json body parser   — parse request bodies
 *   5. request logger     — log after body is parsed
 *   6. routes             — business logic
 *   7. 404 handler        — catch unmatched routes
 *   8. error handler      — catch all thrown/next(err) errors
 */

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const authRoutes = require('./routes/authRoutes');
const publicRoutes = require('./routes/publicRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

// ── 1. Trust proxy ────────────────────────────────────────────
// Railway sits behind a load balancer. Without this setting, all
// requests appear to come from Railway's internal IP, breaking rate
// limiting (all users share the same counter) and IP logging.
// '1' means trust one hop of proxy headers (X-Forwarded-For).
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ── 2. Helmet — security headers ──────────────────────────────
// Helmet sets a suite of HTTP headers that protect against common
// web vulnerabilities (XSS, clickjacking, sniffing, etc.)
app.use(
  helmet({
    // Allow cross-origin requests for the API (frontend is on Vercel).
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // CSP is not applied to the API — the frontend handles its own CSP.
    contentSecurityPolicy: false,
  })
);

// ── 3. CORS ───────────────────────────────────────────────────
// Parse the allowed origins from the environment variable.
// CORS_ORIGINS is a comma-separated list of allowed origins.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// In development, allow all localhost origins for ease of use.
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push(/^http:\/\/localhost:\d+$/);
  allowedOrigins.push(/^http:\/\/127\.0\.0\.1:\d+$/);
}

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no Origin header (curl, Postman, server-to-server).
    if (!origin) return callback(null, true);

    const allowed = allowedOrigins.some((allowed) => {
      if (typeof allowed === 'string') return allowed === origin;
      if (allowed instanceof RegExp) return allowed.test(origin);
      return false;
    });

    if (allowed) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: Origin '${origin}' is not allowed.`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false, // No cookies — we use Bearer tokens
  maxAge: 86400,       // Cache preflight response for 24 hours
};

app.use(cors(corsOptions));
// Explicitly handle OPTIONS preflight for all routes.
app.options('*', cors(corsOptions));

// ── 4. Body parser ────────────────────────────────────────────
// Parse JSON request bodies. Limit to 100kb to prevent large payload attacks.
app.use(express.json({ limit: '100kb' }));
// Parse URL-encoded bodies (form submissions).
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// ── 5. Request logger (development only) ─────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
  });
}

// ── 6. Health check ──────────────────────────────────────────
// Mounted before route groups so it has no middleware overhead.
// Used by Railway for health checks and uptime monitoring.
app.get('/health', async (_req, res) => {
  let dbStatus = 'unknown';
  try {
    const { query } = require('./config/db');
    await query('SELECT 1');
    dbStatus = 'connected';
  } catch {
    dbStatus = 'disconnected';
  }

  const status = dbStatus === 'connected' ? 200 : 503;
  res.status(status).json({
    success: dbStatus === 'connected',
    service: 'greenacre-api',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    database: dbStatus,
  });
});

// ── 7. Route mounting ─────────────────────────────────────────
// Mount order matters for specificity:
//   /api/auth    — login/logout (public, rate-limited)
//   /api/admin   — all admin routes (JWT-protected)
//   /api         — public guest routes (rate-limited)
//
// /api/admin MUST be mounted before /api to prevent the public router's
// catch-all from intercepting admin paths if routing is mis-configured.
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', publicRoutes);

// ── 8. 404 handler ────────────────────────────────────────────
// Catches all requests that didn't match any route.
app.use(notFoundHandler);

// ── 9. Global error handler ───────────────────────────────────
// Must be registered LAST, after all routes and other middleware.
// Express identifies it as an error handler by its 4-argument signature.
app.use(errorHandler);

module.exports = app;
