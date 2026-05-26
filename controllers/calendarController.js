'use strict';

/**
 * controllers/calendarController.js
 *
 * GET /api/calendar?month=YYYY-MM
 *
 * Assembles the full per-day, per-slot availability and pricing response
 * for a given month. Implements the 6-step pricing priority logic via
 * the rateCalculator service.
 *
 * Async errors are forwarded to the global error handler automatically
 * via express-async-errors (required in app.js).
 *
 * Response shape:
 * {
 *   success: true,
 *   month: "2025-06",
 *   year: 2025,
 *   days: [
 *     {
 *       date: "2025-06-01",
 *       dayOfWeek: 0,          // 0=Sun ... 6=Sat
 *       daySlot: {
 *         status: "AVAILABLE"|"BOOKED"|"PENDING_HOLD"|"CLOSED",
 *         available: true|false,
 *         rate: 6000,           // null if unavailable
 *         rateLabel: "NORMAL"|"WEEKEND"|"PEAK"|null,
 *         labelName: "WEEKDAY"|"WEEKEND"|"HOLI"|...,
 *         reason: "weekday_default"|"weekend_default"|"peak_rule"|...
 *       },
 *       nightSlot: { ...same shape... },
 *       fullyBooked: false,
 *       partiallyAvailable: false,
 *       hasAvailability: true
 *     },
 *     ...
 *   ]
 * }
 */

const { query } = require('../config/db');
const { assembleCalendar } = require('../services/rateCalculator');

/**
 * GET /api/calendar?month=YYYY-MM
 *
 * @type {import('express').RequestHandler}
 */
async function getCalendar(req, res) {
  const { month } = req.query;

  // ── Validate month param ──────────────────────────────────────
  if (!month) {
    return res.status(400).json({
      success: false,
      error: 'month query parameter is required (format: YYYY-MM)',
    });
  }

  const monthMatch = month.match(/^(\d{4})-(\d{2})$/);
  if (!monthMatch) {
    return res.status(400).json({
      success: false,
      error: 'Invalid month format. Use YYYY-MM (e.g. 2025-06)',
    });
  }

  const year = parseInt(monthMatch[1], 10);
  const monthNum = parseInt(monthMatch[2], 10);

  if (monthNum < 1 || monthNum > 12) {
    return res.status(400).json({
      success: false,
      error: 'Month must be between 01 and 12',
    });
  }

  if (year < 2020 || year > 2099) {
    return res.status(400).json({
      success: false,
      error: 'Year must be between 2020 and 2099',
    });
  }

  // ── Build month boundaries ────────────────────────────────────
  const monthStr = String(monthNum).padStart(2, '0');
  const startDate = `${year}-${monthStr}-01`;
  const endYear = monthNum === 12 ? year + 1 : year;
  const endMonth = monthNum === 12 ? 1 : monthNum + 1;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  // ── Fetch all data in parallel ────────────────────────────────
  // express-async-errors will catch any DB error thrown here and
  // forward it to the global error handler (500 response).
  const [bookingsResult, pricingRulesResult, defaultRatesResult] = await Promise.all([
    query(
      `SELECT id, booking_date, slot, status
       FROM bookings
       WHERE booking_date >= $1
         AND booking_date < $2
         AND status IN ('PENDING', 'CONFIRMED')
       ORDER BY booking_date, slot`,
      [startDate, endDate]
    ),
    query(
      `SELECT id, target_date, label_name, day_slot_rate, night_slot_rate, is_closed
       FROM pricing_rules
       WHERE target_date >= $1
         AND target_date < $2
       ORDER BY target_date`,
      [startDate, endDate]
    ),
    query(
      `SELECT day_type, day_slot_rate, night_slot_rate
       FROM default_rates
       ORDER BY day_type`,
      []
    ),
  ]);

  // ── Extract default rates ─────────────────────────────────────
  const ratesMap = {};
  for (const row of defaultRatesResult.rows) {
    ratesMap[row.day_type] = row;
  }

  if (!ratesMap.weekday || !ratesMap.weekend) {
    return res.status(503).json({
      success: false,
      error: 'Default rates not configured. Please contact the administrator.',
    });
  }

  // ── Assemble calendar ─────────────────────────────────────────
  const days = assembleCalendar({
    year,
    month: monthNum,
    bookings: bookingsResult.rows,
    pricingRules: pricingRulesResult.rows,
    weekdayRates: ratesMap.weekday,
    weekendRates: ratesMap.weekend,
  });

  return res.status(200).json({
    success: true,
    month,
    year,
    monthNumber: monthNum,
    totalDays: days.length,
    days,
  });
}

module.exports = { getCalendar };
