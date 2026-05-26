'use strict';

/**
 * controllers/auth/authController.js
 *
 * Authentication controller for the admin manager login.
 *
 * Routes:
 *   POST /api/auth/login   → login()
 *   POST /api/auth/logout  → logout()
 *
 * Security characteristics:
 *   • Credentials validated against admins table with bcrypt.compare
 *   • Never reveals whether the username or password was wrong (timing-safe)
 *   • Timing attack mitigation: always runs bcrypt.compare even if user not found
 *   • JWT signed and returned as { token } JSON payload
 *   • last_login timestamp updated on successful login
 *   • Rate limiting applied at the route level (loginRateLimiter middleware)
 *   • Passwords never logged, never returned
 */

const bcrypt = require('bcryptjs');
const { query } = require('../../config/db');
const { signToken } = require('../../config/jwt');

/**
 * Dummy hash used for timing-attack mitigation.
 * When a username is not found, bcrypt.compare is still called against
 * this hash to ensure the response takes the same amount of time as a
 * real failed attempt — preventing username enumeration via timing.
 */
const DUMMY_HASH = '$2a$12$dummyhashfortimingnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn';

/**
 * POST /api/auth/login
 *
 * Body: { username: string, password: string }
 *
 * Success (200): { success: true, token: string, expiresIn: string, username: string }
 * Failure (401): { success: false, error: string }
 *
 * @type {import('express').RequestHandler}
 */
async function login(req, res, next) {
  try {
    const { username, password } = req.body;

    // 1. Look up admin by username.
    const result = await query(
      'SELECT id, username, password_hash FROM admins WHERE username = $1',
      [username.trim().toLowerCase()]
    );

    const admin = result.rows[0] || null;

    // 2. Always run bcrypt.compare — even if no admin found — to prevent
    //    timing attacks that could reveal valid usernames.
    const hashToCompare = admin ? admin.password_hash : DUMMY_HASH;
    const passwordMatch = await bcrypt.compare(password, hashToCompare);

    // 3. Reject if user not found OR password wrong. Same error message
    //    in both cases — do not differentiate.
    if (!admin || !passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password.',
      });
    }

    // 4. Sign JWT with admin identity.
    const token = signToken({
      adminId: admin.id,
      username: admin.username,
    });

    // 5. Update last_login asynchronously — do not await, login should not
    //    fail because of a non-critical timestamp update.
    query(
      'UPDATE admins SET last_login = NOW() WHERE id = $1',
      [admin.id]
    ).catch((err) => {
      console.error('[Auth] Failed to update last_login:', err.message);
    });

    // 6. Return token. Frontend stores this in localStorage and attaches
    //    it as a Bearer token on all subsequent /api/admin/* requests.
    return res.status(200).json({
      success: true,
      token,
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
      username: admin.username,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/logout
 *
 * JWTs are stateless — there is no server-side session to invalidate.
 * This endpoint tells the frontend to clear its stored token.
 *
 * For a future enhancement, a token blocklist (stored in Redis or DB)
 * could be implemented here. Out of scope for Phase 1.
 *
 * Success (200): { success: true, message: string }
 *
 * @type {import('express').RequestHandler}
 */
async function logout(req, res) {
  // Note: requireAuth middleware is NOT applied to this route intentionally.
  // The frontend may call logout even with an expired/missing token to
  // clean up its local state — that should always succeed from the server's
  // perspective.
  return res.status(200).json({
    success: true,
    message: 'Logged out successfully. Please clear your stored token.',
  });
}

module.exports = { login, logout };
