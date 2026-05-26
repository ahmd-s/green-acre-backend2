'use strict';

/**
 * routes/authRoutes.js
 *
 * Authentication routes.
 *
 * Mounted at: /api/auth
 *
 * Routes:
 *   POST /api/auth/login   — rate-limited, validated, returns JWT
 *   POST /api/auth/logout  — always succeeds (JWT is stateless)
 */

const { Router } = require('express');
const { body } = require('express-validator');
const { loginRateLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
const { login, logout } = require('../controllers/auth/authController');

const router = Router();

/**
 * POST /api/auth/login
 *
 * Validation:
 *   - username: required, string, trimmed, lowercased
 *   - password: required, non-empty (length check is in bcrypt logic)
 *
 * Middleware order:
 *   1. loginRateLimiter  — blocks after 5 attempts per 15 min
 *   2. body validators   — check shape of request
 *   3. validate          — short-circuit with 422 if validation fails
 *   4. login controller  — business logic
 */
router.post(
  '/login',
  loginRateLimiter,
  [
    body('username')
      .trim()
      .notEmpty()
      .withMessage('Username is required.')
      .isLength({ max: 60 })
      .withMessage('Username must be 60 characters or fewer.')
      .toLowerCase(),

    body('password')
      .notEmpty()
      .withMessage('Password is required.')
      .isLength({ min: 1, max: 200 })
      .withMessage('Password must be between 1 and 200 characters.'),
  ],
  validate,
  login
);

/**
 * POST /api/auth/logout
 *
 * No auth middleware required — logout must work even with an expired token.
 * No body validation required — no body expected.
 */
router.post('/logout', logout);

module.exports = router;
