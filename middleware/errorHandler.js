'use strict';

/**
 * middleware/errorHandler.js
 *
 * Centralised error handling for the entire Express application.
 *
 * Two handlers are exported and mounted in app.js:
 *
 *   notFoundHandler  — Catches requests to undefined routes (404).
 *   errorHandler     — Catches all errors thrown or passed via next(err).
 *
 * Error classification:
 *   - Validation errors (express-validator)  → 422
 *   - PostgreSQL constraint violations        → 409
 *   - JWT errors (caught here as fallback)   → 401
 *   - Explicitly set err.statusCode          → use that code
 *   - Everything else                        → 500 (Internal Server Error)
 *
 * In production, stack traces are never sent to the client.
 * In development, the stack is included for debugging.
 */

/**
 * Creates a standardised error object for throwing inside controllers.
 * Usage: throw createError(400, 'Booking date is in the past.');
 *
 * @param {number} statusCode
 * @param {string} message
 * @returns {Error & { statusCode: number }}
 */
function createError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * 404 handler — mounted AFTER all route definitions.
 * Catches requests to any path that no router handled.
 *
 * @type {import('express').RequestHandler}
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

/**
 * Global error handler — must be the LAST middleware registered (4 args).
 * Express identifies it as an error handler by its 4-argument signature.
 *
 * @type {import('express').ErrorRequestHandler}
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isDev = process.env.NODE_ENV !== 'production';

  // ── PostgreSQL error codes ──────────────────────────────────────
  if (err.code) {
    // Unique constraint violation (e.g. duplicate ref ID, duplicate booking slot)
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'A conflict occurred. The resource already exists.',
        detail: isDev ? err.detail : undefined,
      });
    }
    // Foreign key violation
    if (err.code === '23503') {
      return res.status(409).json({
        success: false,
        error: 'Referenced resource does not exist.',
        detail: isDev ? err.detail : undefined,
      });
    }
    // Not-null violation
    if (err.code === '23502') {
      return res.status(422).json({
        success: false,
        error: 'A required field is missing.',
        detail: isDev ? err.detail : undefined,
      });
    }
  }

  // ── JWT errors (fallback — normally caught in authMiddleware) ───
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: 'Session expired. Please log in again.',
      code: 'TOKEN_EXPIRED',
    });
  }
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: 'Invalid authentication token.',
      code: 'TOKEN_INVALID',
    });
  }

  // ── Explicit status code set by controllers ─────────────────────
  const statusCode = err.statusCode || 500;
  const message =
    statusCode === 500 && !isDev
      ? 'An unexpected error occurred. Please try again later.'
      : err.message || 'Internal Server Error';

  // Always log server errors on the backend.
  if (statusCode === 500) {
    console.error('[ERROR]', {
      path: req.originalUrl,
      method: req.method,
      message: err.message,
      stack: isDev ? err.stack : undefined,
    });
  }

  return res.status(statusCode).json({
    success: false,
    error: message,
    stack: isDev ? err.stack : undefined,
  });
}

module.exports = { createError, notFoundHandler, errorHandler };
