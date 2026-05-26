'use strict';

/**
 * controllers/adminPolicyController.js
 *
 * Admin policy management:
 *   GET /api/admin/policy                — get all 4 policy sections
 *   PUT /api/admin/policy/:sectionKey    — update a single section
 *
 * section_key is an application-enforced enum. Unknown keys return 404.
 * Async errors forwarded to global error handler via express-async-errors.
 */

const { query } = require('../config/db');

/** Valid section keys — must match the CHECK constraint in the schema. */
const VALID_SECTION_KEYS = ['checkout_policy', 'cleanliness', 'pool_safety', 'house_rules'];

/**
 * GET /api/admin/policy
 *
 * @type {import('express').RequestHandler}
 */
async function getAdminPolicy(req, res) {
  const result = await query(
    `SELECT id, section_key, content_text, updated_at
     FROM policy_content
     ORDER BY id`,
    []
  );

  return res.status(200).json({
    success: true,
    policies: result.rows,
    validSectionKeys: VALID_SECTION_KEYS,
  });
}

/**
 * PUT /api/admin/policy/:sectionKey
 * Updates content_text for a single policy section.
 * Returns 404 for unknown section keys (per masterplan spec).
 *
 * @type {import('express').RequestHandler}
 */
async function updatePolicy(req, res) {
  const { sectionKey } = req.params;
  const { content_text } = req.body;

  // Validate section key — return 404 for unknown keys (not 422).
  // This prevents silent creation of rogue rows via typo'd keys.
  if (!VALID_SECTION_KEYS.includes(sectionKey)) {
    return res.status(404).json({
      success: false,
      error: `Unknown policy section: "${sectionKey}". Valid sections: ${VALID_SECTION_KEYS.join(', ')}`,
    });
  }

  if (content_text === undefined || content_text === null) {
    return res.status(400).json({
      success: false,
      error: 'content_text is required.',
    });
  }

  if (typeof content_text !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'content_text must be a string.',
    });
  }

  // Update the existing row
  const result = await query(
    `UPDATE policy_content
     SET content_text = $1, updated_at = NOW()
     WHERE section_key = $2
     RETURNING id, section_key, content_text, updated_at`,
    [content_text.trim(), sectionKey]
  );

  if (result.rowCount === 0) {
    // Valid key but row missing — insert it (handles partial seed edge case)
    const insertResult = await query(
      `INSERT INTO policy_content (section_key, content_text, updated_at)
       VALUES ($1, $2, NOW())
       RETURNING id, section_key, content_text, updated_at`,
      [sectionKey, content_text.trim()]
    );
    return res.status(200).json({
      success: true,
      message: 'Policy section created.',
      policy: insertResult.rows[0],
    });
  }

  return res.status(200).json({
    success: true,
    message: 'Policy section updated.',
    policy: result.rows[0],
  });
}

module.exports = { getAdminPolicy, updatePolicy };
