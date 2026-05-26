'use strict';

/**
 * controllers/policyController.js
 *
 * GET /api/policy
 * Returns all 4 policy_content records for the guest-facing policy modal.
 *
 * Async errors forwarded to global error handler via express-async-errors.
 */

const { query } = require('../config/db');

/**
 * GET /api/policy
 *
 * @type {import('express').RequestHandler}
 */
async function getPolicy(req, res) {
  const result = await query(
    `SELECT section_key, content_text, updated_at
     FROM policy_content
     ORDER BY id`,
    []
  );

  // Return as both array and keyed map for frontend flexibility
  const policiesArray = result.rows;
  const policiesMap = {};
  for (const row of result.rows) {
    policiesMap[row.section_key] = {
      content: row.content_text,
      updatedAt: row.updated_at,
    };
  }

  return res.status(200).json({
    success: true,
    policies: policiesArray,
    policiesMap,
  });
}

module.exports = { getPolicy };
