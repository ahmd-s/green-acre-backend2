'use strict';

/**
 * config/jwt.js
 *
 * JWT utility functions — sign and verify tokens.
 *
 * Tokens are signed with HS256 (HMAC-SHA256) using the JWT_SECRET
 * environment variable. The secret must be at least 64 characters of
 * cryptographic randomness — see .env.example for generation instructions.
 *
 * Token payload:
 *   { adminId, username, iat, exp }
 *
 * Expiry: 8 hours (configurable via JWT_EXPIRES_IN env var).
 * No refresh tokens — manager must re-login after expiry.
 */

const jwt = require('jsonwebtoken');

/** The signing secret — validated at startup by server.js. */
const JWT_SECRET = process.env.JWT_SECRET;

/** Token lifetime — default 8h as per masterplan security requirements. */
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

/**
 * Signs a JWT for a successfully authenticated admin.
 *
 * @param {{ adminId: number, username: string }} payload
 * @returns {string} Signed JWT string
 */
function signToken(payload) {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured. Cannot sign tokens.');
  }
  return jwt.sign(
    {
      adminId: payload.adminId,
      username: payload.username,
    },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN,
      algorithm: 'HS256',
    }
  );
}

/**
 * Verifies a JWT string and returns the decoded payload.
 * Throws JsonWebTokenError or TokenExpiredError on failure —
 * callers should catch these and return 401.
 *
 * @param {string} token
 * @returns {{ adminId: number, username: string, iat: number, exp: number }}
 */
function verifyToken(token) {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured. Cannot verify tokens.');
  }
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
}

/**
 * Extracts the Bearer token from an Authorization header value.
 * Returns null if the header is missing or malformed.
 *
 * @param {string|undefined} authHeader - Value of req.headers.authorization
 * @returns {string|null}
 */
function extractBearerToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

module.exports = { signToken, verifyToken, extractBearerToken };
