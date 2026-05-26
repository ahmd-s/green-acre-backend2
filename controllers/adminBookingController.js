'use strict';

/**
 * controllers/adminBookingController.js
 *
 * Admin operations on bookings:
 *   GET    /api/admin/bookings                   — list with filters
 *   PATCH  /api/admin/bookings/:id/confirm       — confirm PENDING booking
 *   PATCH  /api/admin/bookings/:id/release       — release PENDING/CONFIRMED booking
 */

const { query, getClient } = require('../config/db');
const { notifyGuestConfirmed } = require('../services/whatsapp');

/**
 * GET /api/admin/bookings
 * Query params: status, date, month, page, limit
 */
async function listBookings(req, res) {
  const {
    status,
    date,
    month,
    page = 1,
    limit = 20,
  } = req.query;

  const conditions = [];
  const params = [];
  let paramIdx = 1;

  // Filter by status
  const validStatuses = ['PENDING', 'CONFIRMED', 'RELEASED', 'CANCELLED'];
  if (status) {
    const statusList = status.split(',').map((s) => s.trim().toUpperCase());
    const invalidStatuses = statusList.filter((s) => !validStatuses.includes(s));
    if (invalidStatuses.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid status values: ${invalidStatuses.join(', ')}. Valid: ${validStatuses.join(', ')}`,
      });
    }
    conditions.push(`status = ANY($${paramIdx++})`);
    params.push(statusList);
  }

  // Filter by exact date
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
    }
    conditions.push(`booking_date = $${paramIdx++}`);
    params.push(date);
  }

  // Filter by month
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
    }
    conditions.push(`DATE_TRUNC('month', booking_date) = DATE_TRUNC('month', $${paramIdx++}::date)`);
    params.push(month + '-01');
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // Pagination
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (pageNum - 1) * limitNum;

  // Count query
  const countResult = await query(
    `SELECT COUNT(*) AS total FROM bookings ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].total, 10);

  // Data query
  const dataResult = await query(
    `SELECT id, guest_name, guest_phone, guest_email, guest_count,
            occasion, notes, booking_date, slot,
            rate_applied, rate_label, status, policy_agreed,
            created_at, confirmed_at, released_at
     FROM bookings
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limitNum, offset]
  );

  return res.status(200).json({
    success: true,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
    bookings: dataResult.rows.map((b) => ({
      ...b,
      rate_applied: parseFloat(b.rate_applied),
    })),
  });
}

/**
 * PATCH /api/admin/bookings/:id/confirm
 * Transitions PENDING → CONFIRMED.
 * Uses a transaction to guard against auto-release race conditions.
 */
async function confirmBooking(req, res) {
  const { id } = req.params;

  if (!id || !/^GRN-\d{4}-\d{4}$/.test(id)) {
    return res.status(400).json({ success: false, error: 'Invalid booking ID format.' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock the row — prevents auto-release cron from racing
    const lockResult = await client.query(
      `SELECT id, status, guest_name, guest_phone, booking_date, slot, rate_applied, rate_label
       FROM bookings
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (lockResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Booking not found.' });
    }

    const booking = lockResult.rows[0];

    if (booking.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        error: `Cannot confirm booking with status: ${booking.status}. Only PENDING bookings can be confirmed.`,
        currentStatus: booking.status,
      });
    }

    const updateResult = await client.query(
      `UPDATE bookings
       SET status = 'CONFIRMED', confirmed_at = NOW()
       WHERE id = $1 AND status = 'PENDING'
       RETURNING id, status, confirmed_at, guest_name, guest_phone,
                 booking_date, slot, rate_applied, rate_label`,
      [id]
    );

    await client.query('COMMIT');

    const confirmed = updateResult.rows[0];

    // Fire-and-forget guest notification
    notifyGuestConfirmed(confirmed);

    return res.status(200).json({
      success: true,
      message: 'Booking confirmed successfully.',
      booking: {
        ...confirmed,
        rate_applied: parseFloat(confirmed.rate_applied),
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * PATCH /api/admin/bookings/:id/release
 * Transitions PENDING or CONFIRMED → RELEASED.
 * Admin can release either status (with CONFIRMED requiring intentional action).
 */
async function releaseBooking(req, res) {
  const { id } = req.params;
  const { reason } = req.body; // Optional reason string

  if (!id || !/^GRN-\d{4}-\d{4}$/.test(id)) {
    return res.status(400).json({ success: false, error: 'Invalid booking ID format.' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const lockResult = await client.query(
      `SELECT id, status FROM bookings WHERE id = $1 FOR UPDATE`,
      [id]
    );

    if (lockResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Booking not found.' });
    }

    const currentStatus = lockResult.rows[0].status;

    if (!['PENDING', 'CONFIRMED'].includes(currentStatus)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        error: `Cannot release booking with status: ${currentStatus}. Only PENDING or CONFIRMED bookings can be released.`,
        currentStatus,
      });
    }

    const updateResult = await client.query(
      `UPDATE bookings
       SET status = 'RELEASED', released_at = NOW()
       WHERE id = $1 AND status IN ('PENDING', 'CONFIRMED')
       RETURNING id, status, released_at, guest_name, booking_date, slot`,
      [id]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Booking released successfully. The slot is now available.',
      booking: updateResult.rows[0],
      reason: reason || null,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { listBookings, confirmBooking, releaseBooking };
