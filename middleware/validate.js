'use strict';

/**
 * middleware/validate.js
 *
 * Reusable middleware that checks the result of express-validator chains.
 * Mount this AFTER the validation chain array on any route that needs input validation.
 *
 * Usage in a route:
 *   const { body } = require('express-validator');
 *   const { validate } = require('../middleware/validate');
 *
 *   router.post('/login',
 *     [
 *       body('username').notEmpty().trim(),
 *       body('password').isLength({ min: 8 }),
 *     ],
 *     validate,
 *     authController.login
 *   );
 *
 * Returns 422 with a structured errors array if validation fails.
 * Calls next() if all validators pass.
 */

const { validationResult } = require('express-validator');

/**
 * Runs after express-validator chains and short-circuits with 422
 * if any field failed validation.
 *
 * @type {import('express').RequestHandler}
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      error: 'Validation failed.',
      // Map to a clean array: [{ field: 'username', message: '...' }]
      errors: errors.array().map((e) => ({
        field: e.path || e.param,
        message: e.msg,
      })),
    });
  }
  next();
}

module.exports = { validate };
