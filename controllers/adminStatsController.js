'use strict';

/**
 * controllers/adminStatsController.js
 *
 * GET /api/admin/stats
 * Returns dashboard statistics for the admin panel.
 *
 * Async errors forwarded to global error handler via express-async-errors.
 */

const { query } = require('../config/db');

/**
 * GET /api/admin/stats
 *
 * @type {import('express').RequestHandler}
 */
async function getStats(req, res) {
  // Run all stat queries in parallel for performance
  const [statusCountsResult, revenueResult, upcomingResult, recentResult] = await Promise.all([
    // Booking counts by status (all time)
    query(
      `SELECT status, COUNT(*) AS count
       FROM bookings
       GROUP BY status`,
      []
    ),

    // Revenue from confirmed bookings
    query(
      `SELECT
         COALESCE(SUM(rate_applied) FILTER (WHERE status = 'CONFIRMED'), 0) AS confirmed_revenue,
         COALESCE(SUM(rate_applied) FILTER (
           WHERE status = 'CONFIRMED'
             AND DATE_TRUNC('month', booking_date) = DATE_TRUNC('month', NOW())
         ), 0) AS this_month_revenue,
         COUNT(*) FILTER (WHERE status = 'CONFIRMED') AS total_confirmed
       FROM bookings`,
      []
    ),

    // Upcoming confirmed bookings (next 30 days)
    query(
      `SELECT id, guest_name, booking_date, slot, rate_applied, rate_label, guest_count
       FROM bookings
       WHERE status = 'CONFIRMED'
         AND booking_date >= CURRENT_DATE
         AND booking_date <= CURRENT_DATE + INTERVAL '30 days'
       ORDER BY booking_date, slot
       LIMIT 10`,
      []
    ),

    // Most recent pending bookings (action required)
    query(
      `SELECT id, guest_name, guest_phone, booking_date, slot,
              rate_applied, rate_label, guest_count, created_at
       FROM bookings
       WHERE status = 'PENDING'
       ORDER BY created_at DESC
       LIMIT 5`,
      []
    ),
  ]);

  // Build status map with safe defaults
  const statusCounts = { PENDING: 0, CONFIRMED: 0, RELEASED: 0, CANCELLED: 0 };
  for (const row of statusCountsResult.rows) {
    statusCounts[row.status] = parseInt(row.count, 10);
  }

  const revenue = revenueResult.rows[0];

  return res.status(200).json({
    success: true,
    stats: {
      bookings: {
        pending: statusCounts.PENDING,
        confirmed: statusCounts.CONFIRMED,
        released: statusCounts.RELEASED,
        cancelled: statusCounts.CANCELLED,
        total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
      },
      revenue: {
        total: parseFloat(revenue.confirmed_revenue),
        thisMonth: parseFloat(revenue.this_month_revenue),
        totalConfirmed: parseInt(revenue.total_confirmed, 10),
      },
      upcoming: upcomingResult.rows.map((b) => ({
        ...b,
        rate_applied: parseFloat(b.rate_applied),
      })),
      recentPending: recentResult.rows.map((b) => ({
        ...b,
        rate_applied: parseFloat(b.rate_applied),
      })),
    },
    generatedAt: new Date().toISOString(),
  });
}

module.exports = { getStats };
