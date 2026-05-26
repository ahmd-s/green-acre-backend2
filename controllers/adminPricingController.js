'use strict';

/**
 * controllers/adminPricingController.js
 *
 * Admin pricing management:
 *   GET    /api/admin/pricing-rules?month=YYYY-MM&date=YYYY-MM-DD
 *   POST   /api/admin/pricing-rules          — create/upsert rule for a date
 *   PUT    /api/admin/pricing-rules/:id      — update rule by ID
 *   DELETE /api/admin/pricing-rules/:id      — delete rule (date reverts to default)
 *   GET    /api/admin/default-rates          — get weekday/weekend baseline rates
 *   PUT    /api/admin/default-rates/:id      — update a baseline rate row
 *
 * Also used by publicRoutes for:
 *   GET    /api/pricing-rules?date=YYYY-MM-DD — guest-facing single date rate lookup
 *
 * Async errors forwarded to global error handler via express-async-errors.
 */

const { query } = require('../config/db');

/** Valid label values — must match the DB CHECK constraint. */
const VALID_LABELS = ['NORMAL', 'WEEKEND', 'HOLI', 'DIWALI', 'EID', 'PEAK', 'CUSTOM'];

// ── Pricing Rules ─────────────────────────────────────────────

/**
 * GET /api/admin/pricing-rules?month=YYYY-MM&date=YYYY-MM-DD
 * Also used publicly: GET /api/pricing-rules?date=YYYY-MM-DD
 *
 * @type {import('express').RequestHandler}
 */
async function listPricingRules(req, res) {
  const { month, date } = req.query;

  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
    }
    conditions.push(`target_date = $${paramIdx++}`);
    params.push(date);
  } else if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
    }
    conditions.push(
      `DATE_TRUNC('month', target_date) = DATE_TRUNC('month', $${paramIdx++}::date)`
    );
    params.push(month + '-01');
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const result = await query(
    `SELECT id, target_date, label_name, day_slot_rate, night_slot_rate, is_closed, created_at, updated_at
     FROM pricing_rules
     ${whereClause}
     ORDER BY target_date`,
    params
  );

  return res.status(200).json({
    success: true,
    total: result.rowCount,
    rules: result.rows.map((r) => ({
      ...r,
      day_slot_rate: r.day_slot_rate ? parseFloat(r.day_slot_rate) : null,
      night_slot_rate: r.night_slot_rate ? parseFloat(r.night_slot_rate) : null,
    })),
  });
}

/**
 * POST /api/admin/pricing-rules
 * Creates or upserts a pricing rule for a date.
 * ON CONFLICT (target_date) DO UPDATE — safe to call multiple times.
 *
 * @type {import('express').RequestHandler}
 */
async function createPricingRule(req, res) {
  const errors = validatePricingRuleBody(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
  }

  const { target_date, label_name, day_slot_rate, night_slot_rate, is_closed } = req.body;
  const isClosed = is_closed === true || is_closed === 'true';

  const result = await query(
    `INSERT INTO pricing_rules (target_date, label_name, day_slot_rate, night_slot_rate, is_closed, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (target_date) DO UPDATE
       SET label_name      = EXCLUDED.label_name,
           day_slot_rate   = EXCLUDED.day_slot_rate,
           night_slot_rate = EXCLUDED.night_slot_rate,
           is_closed       = EXCLUDED.is_closed,
           updated_at      = NOW()
     RETURNING id, target_date, label_name, day_slot_rate, night_slot_rate, is_closed, created_at, updated_at`,
    [
      target_date,
      label_name,
      day_slot_rate != null ? parseFloat(day_slot_rate) : null,
      night_slot_rate != null ? parseFloat(night_slot_rate) : null,
      isClosed,
    ]
  );

  const rule = result.rows[0];
  return res.status(201).json({
    success: true,
    message: 'Pricing rule saved.',
    rule: {
      ...rule,
      day_slot_rate: rule.day_slot_rate ? parseFloat(rule.day_slot_rate) : null,
      night_slot_rate: rule.night_slot_rate ? parseFloat(rule.night_slot_rate) : null,
    },
  });
}

/**
 * PUT /api/admin/pricing-rules/:id
 *
 * @type {import('express').RequestHandler}
 */
async function updatePricingRule(req, res) {
  const ruleId = parseInt(req.params.id, 10);
  if (!ruleId || isNaN(ruleId)) {
    return res.status(400).json({ success: false, error: 'Invalid rule ID.' });
  }

  const errors = validatePricingRuleBody(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
  }

  const { target_date, label_name, day_slot_rate, night_slot_rate, is_closed } = req.body;

  const result = await query(
    `UPDATE pricing_rules
     SET target_date     = $1,
         label_name      = $2,
         day_slot_rate   = $3,
         night_slot_rate = $4,
         is_closed       = $5,
         updated_at      = NOW()
     WHERE id = $6
     RETURNING id, target_date, label_name, day_slot_rate, night_slot_rate, is_closed, updated_at`,
    [
      target_date,
      label_name,
      day_slot_rate != null ? parseFloat(day_slot_rate) : null,
      night_slot_rate != null ? parseFloat(night_slot_rate) : null,
      is_closed === true || is_closed === 'true',
      ruleId,
    ]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ success: false, error: 'Pricing rule not found.' });
  }

  const rule = result.rows[0];
  return res.status(200).json({
    success: true,
    message: 'Pricing rule updated.',
    rule: {
      ...rule,
      day_slot_rate: rule.day_slot_rate ? parseFloat(rule.day_slot_rate) : null,
      night_slot_rate: rule.night_slot_rate ? parseFloat(rule.night_slot_rate) : null,
    },
  });
}

/**
 * DELETE /api/admin/pricing-rules/:id
 * Removes a custom pricing rule — the date reverts to default rate logic.
 *
 * @type {import('express').RequestHandler}
 */
async function deletePricingRule(req, res) {
  const ruleId = parseInt(req.params.id, 10);
  if (!ruleId || isNaN(ruleId)) {
    return res.status(400).json({ success: false, error: 'Invalid rule ID.' });
  }

  const result = await query(
    `DELETE FROM pricing_rules WHERE id = $1 RETURNING id, target_date, label_name`,
    [ruleId]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ success: false, error: 'Pricing rule not found.' });
  }

  return res.status(200).json({
    success: true,
    message: 'Pricing rule deleted. This date now uses default rate logic.',
    deleted: result.rows[0],
  });
}

// ── Default Rates ─────────────────────────────────────────────

/**
 * GET /api/admin/default-rates
 *
 * @type {import('express').RequestHandler}
 */
async function getDefaultRates(req, res) {
  const result = await query(
    `SELECT id, day_type, day_slot_rate, night_slot_rate, updated_at
     FROM default_rates
     ORDER BY day_type`,
    []
  );

  return res.status(200).json({
    success: true,
    rates: result.rows.map((r) => ({
      ...r,
      day_slot_rate: parseFloat(r.day_slot_rate),
      night_slot_rate: parseFloat(r.night_slot_rate),
    })),
  });
}

/**
 * PUT /api/admin/default-rates/:id
 * Updates one default_rates row (weekday or weekend).
 * Accepts partial updates — only provided fields are changed.
 *
 * @type {import('express').RequestHandler}
 */
async function updateDefaultRate(req, res) {
  const rateId = parseInt(req.params.id, 10);
  if (!rateId || isNaN(rateId)) {
    return res.status(400).json({ success: false, error: 'Invalid rate ID.' });
  }

  const { day_slot_rate, night_slot_rate } = req.body;
  const errors = [];

  if (day_slot_rate === undefined && night_slot_rate === undefined) {
    errors.push('At least one of day_slot_rate or night_slot_rate is required.');
  }
  if (day_slot_rate !== undefined) {
    const v = parseFloat(day_slot_rate);
    if (isNaN(v) || v <= 0) errors.push('day_slot_rate must be a positive number.');
  }
  if (night_slot_rate !== undefined) {
    const v = parseFloat(night_slot_rate);
    if (isNaN(v) || v <= 0) errors.push('night_slot_rate must be a positive number.');
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
  }

  // Build dynamic SET clause — only update provided fields
  const sets = [];
  const params = [];
  let paramIdx = 1;

  if (day_slot_rate !== undefined) {
    sets.push(`day_slot_rate = $${paramIdx++}`);
    params.push(parseFloat(day_slot_rate));
  }
  if (night_slot_rate !== undefined) {
    sets.push(`night_slot_rate = $${paramIdx++}`);
    params.push(parseFloat(night_slot_rate));
  }
  sets.push(`updated_at = NOW()`);
  params.push(rateId);

  const result = await query(
    `UPDATE default_rates
     SET ${sets.join(', ')}
     WHERE id = $${paramIdx}
     RETURNING id, day_type, day_slot_rate, night_slot_rate, updated_at`,
    params
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ success: false, error: 'Default rate not found.' });
  }

  const rate = result.rows[0];
  return res.status(200).json({
    success: true,
    message: `${rate.day_type} rates updated.`,
    rate: {
      ...rate,
      day_slot_rate: parseFloat(rate.day_slot_rate),
      night_slot_rate: parseFloat(rate.night_slot_rate),
    },
  });
}

// ── Validation helper ─────────────────────────────────────────

/**
 * Validates the body for create/update pricing rule requests.
 * @param {Object} body
 * @returns {string[]} Array of error messages (empty = valid)
 */
function validatePricingRuleBody(body) {
  const errors = [];
  const { target_date, label_name, day_slot_rate, night_slot_rate, is_closed } = body;

  if (!target_date || !/^\d{4}-\d{2}-\d{2}$/.test(target_date)) {
    errors.push('target_date is required (YYYY-MM-DD)');
  }

  if (!label_name || !VALID_LABELS.includes(label_name)) {
    errors.push(`label_name must be one of: ${VALID_LABELS.join(', ')}`);
  }

  const isClosed = is_closed === true || is_closed === 'true';
  if (!isClosed) {
    if (day_slot_rate != null) {
      const v = parseFloat(day_slot_rate);
      if (isNaN(v) || v <= 0) errors.push('day_slot_rate must be a positive number');
    }
    if (night_slot_rate != null) {
      const v = parseFloat(night_slot_rate);
      if (isNaN(v) || v <= 0) errors.push('night_slot_rate must be a positive number');
    }
  }

  return errors;
}

module.exports = {
  listPricingRules,
  createPricingRule,
  updatePricingRule,
  deletePricingRule,
  getDefaultRates,
  updateDefaultRate,
};
