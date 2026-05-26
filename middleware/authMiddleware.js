'use strict';

/**
 * middleware/authMiddleware.js
 *
 * JWT authentication middleware.
 * Applied to ALL /api/admin/* routes.
 *
 * Expects:  Authorization: Bearer <token>
 * On success: attaches req.admin = { adminId, username } and calls next()
 * On failure: returns 401 JSON — never calls next()
 *
 * The middleware distinguishes between:
 *   - Missing token   → 401 "Authentication required"
 *   - Expired token   → 401 "Session expired" (prompt re-login)
 *   - Invalid token   → 401 "Invalid token" (tampered / wrong secret)
 */

const { verifyToken, extractBearerToken } = require('../config/jwt');
const jwt = require('jsonwebtoken');

/**
 * requireAuth — guard middleware for all admin-facing endpoints.
 * Mount this on the /api/admin router, not on individual routes,
 * to guarantee no admin endpoint is ever reachable without a valid token.
 *
 * @type {import('express').RequestHandler}
 */
function requireAuth(req, res, next) {
  // 1. Extract token from Authorization header.
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Provide a Bearer token.',
    });
  }

  // 2. Verify signature and expiry.
  try {
    const decoded = verifyToken(token);
    // Attach decoded payload so downstream controllers can read admin identity.
    req.admin = {
      adminId: decoded.adminId,
      username: decoded.username,
    };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        success: false,
        error: 'Session expired. Please log in again.',
        code: 'TOKEN_EXPIRED',
      });
    }
    // Covers JsonWebTokenError (bad signature, malformed token, wrong algorithm).
    return res.status(401).json({
      success: false,
      error: 'Invalid authentication token.',
      code: 'TOKEN_INVALID',
    });
  }
}

module.exports = { requireAuth };
