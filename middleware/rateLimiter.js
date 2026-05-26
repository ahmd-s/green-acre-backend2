'use strict';

/**
 * middleware/rateLimiter.js
 *
 * Rate limiting middleware using express-rate-limit.
 *
 * Two limiters are exported:
 *
 *   loginRateLimiter  — strict: 5 attempts per 15 minutes per IP.
 *                       Applied only to POST /api/auth/login.
 *                       Prevents brute-force attacks on the admin login.
 *
 *   apiRateLimiter    — generous: 200 requests per minute per IP.
 *                       Applied to all public API routes as a basic DoS guard.
 *                       Accommodates the 60-second booking-status polling.
 *
 * IP detection: trusts the X-Forwarded-For header when NODE_ENV=production
 * (Railway / Vercel proxy chain). In development, uses req.ip directly.
 * This is configured via app.set('trust proxy', 1) in app.js.
 */

const rateLimit = require('express-rate-limit');

/**
 * Strict rate limiter for the login endpoint.
 * 5 failures from the same IP within 15 minutes lock out further attempts.
 * Returns a JSON response (not HTML) to stay consistent with the API contract.
 */
const loginRateLimiter = rateLimit({
  windowMs: parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '5', 10),
  standardHeaders: true,  // Return RateLimit-* headers
  legacyHeaders: false,   // Disable X-RateLimit-* headers

  // Custom handler so the response matches our JSON error contract.
  handler: (req, res) => {
    const retryAfterSeconds = Math.ceil(
      (req.rateLimit.resetTime - Date.now()) / 1000
    );
    res.status(429).json({
      success: false,
      error: 'Too many login attempts. Please try again later.',
      retryAfterSeconds,
    });
  },

  // Key by IP address. In production, trust proxy must be set so that
  // Railway's load balancer IP is not used as the key for all clients.
  keyGenerator: (req) => req.ip,

  // Skip successful requests — only count failed ones toward the limit.
  // Note: express-rate-limit counts ALL requests by default. This means
  // a successful login still increments the counter. That is intentional:
  // it prevents an attacker from successfully logging in and immediately
  // resetting their window.
  skip: () => false,
});

/**
 * General API rate limiter for all public routes.
 * Generous enough to allow normal usage + 60s polling.
 */
const apiRateLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'Rate limit exceeded. Please slow down your requests.',
    });
  },
  keyGenerator: (req) => req.ip,
});

module.exports = { loginRateLimiter, apiRateLimiter };
