'use strict';

/**
 * controllers/bookingController.js
 *
 * Handles guest-facing booking operations:
 *   POST /api/bookings/request  — create a new PENDING booking
 *   GET  /api/bookings/:refId   — poll booking status
 *   PATCH /api/bookings/:refId/cancel — guest cancels (optional)
 *
 * COLLISION PREVENTION:
 *   POST /bookings/request uses a PostgreSQL transaction with
 *   SELECT ... FOR UPDATE to lock the (booking_date, slot) combination.
 *   Only one request can hold the lock at a time — the second concurrent
 *   request will block until the first commits or rolls back.
 *   This prevents double-bookings even under race conditions.
 */

const { getClient, query } = require('../config/db');
const { generateUniqueRefId } = require('../utils/generateRefId');
const { resolveSlotStatus } = require('../services/rateCalculator');
const { notifyManager, notifyGuest } = require('../services/whatsapp');

/** Valid section keys for policy validation */
const VALID_SECTION_KEYS = ['checkout_policy', 'cleanliness', 'pool_safety', 'house_rules'];

// ── Validation helpers ────────────────────────────────────────

function validateBookingRequest(body) {
  const errors = [];

  if (!body.guest_name || typeof body.guest_name !== 'string' || body.guest_name.trim().length < 2) {
    errors.push('guest_name is required (min 2 characters)');
  }

  if (!body.guest_phone || typeof body.guest_phone !== 'string') {
    errors.push('guest_phone is required');
  } else {
    // Allow +91XXXXXXXXXX, 91XXXXXXXXXX, 0XXXXXXXXXX, XXXXXXXXXX
    const phoneClean = body.guest_phone.replace(/[\s\-().]/g, '');
    if (!/^(\+?91|0)?[6-9]\d{9}$/.test(phoneClean)) {
      errors.push('guest_phone must be a valid Indian mobile number');
    }
  }

  if (body.guest_email && typeof body.guest_email === 'string' && body.guest_email.trim()) {
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(body.guest_email.trim())) {
      errors.push('guest_email must be a valid email address');
    }
  }

  if (!body.guest_count || !Number.isInteger(Number(body.guest_count))) {
    errors.push('guest_count is required and must be an integer');
  } else {
    const count = Number(body.guest_count);
    if (count < 1 || count > 200) {
      errors.push('guest_count must be between 1 and 200');
    }
  }

  if (!body.booking_date) {
    errors.push('booking_date is required');
  } else {
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(body.booking_date)) {
      errors.push('booking_date must be in YYYY-MM-DD format');
    } else {
      const d = new Date(body.booking_date + 'T12:00:00+05:30');
      if (isNaN(d.getTime())) {
        errors.push('booking_date is not a valid date');
      } else {
        // Cannot book in the past (IST today)
        const todayIST = new Date(
          new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
        );
        todayIST.setHours(0, 0, 0, 0);
        if (d < todayIST) {
          errors.push('booking_date cannot be in the past');
        }
      }
    }
  }

  if (!body.slot || !['day', 'night'].includes(body.slot)) {
    errors.push('slot must be either "day" or "night"');
  }

  if (body.policy_agreed !== true && body.policy_agreed !== 'true') {
    errors.push('policy_agreed must be true — guest must accept the property policies');
  }

  return errors;
}

// ── Controllers ───────────────────────────────────────────────

/**
 * POST /api/bookings/request
 * Creates a new PENDING booking with full collision protection.
 */
async function createBooking(req, res) {
  const body = req.body;

  // ── Input validation ────────────────────────────────────────
  const errors = validateBookingRequest(body);
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors,
    });
  }

  const bookingDate = body.booking_date;
  const slot = body.slot;

  // ── Transaction with advisory lock ──────────────────────────
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // LOCK: Select all active bookings for this date+slot FOR UPDATE.
    // This serializes concurrent requests for the same slot.
    // Any other transaction trying to book the same slot will BLOCK here
    // until this transaction completes.
    const lockResult = await client.query(
      `SELECT id, status FROM bookings
       WHERE booking_date = $1
         AND slot = $2
         AND status IN ('PENDING', 'CONFIRMED')
       FOR UPDATE`,
      [bookingDate, slot]
    );

    if (lockResult.rowCount > 0) {
      await client.query('ROLLBACK');
      const existingStatus = lockResult.rows[0].status;
      return res.status(409).json({
        success: false,
        error:
          existingStatus === 'CONFIRMED'
            ? 'This slot is already booked. Please choose a different date or slot.'
            : 'This slot is currently on hold. Please choose a different date or slot, or try again shortly.',
        status: existingStatus,
      });
    }

    // ── Fetch current pricing for this date+slot ─────────────
    const [pricingRuleResult, defaultRatesResult] = await Promise.all([
      client.query(
        `SELECT id, label_name, day_slot_rate, night_slot_rate, is_closed
         FROM pricing_rules WHERE target_date = $1`,
        [bookingDate]
      ),
      client.query(
        `SELECT day_type, day_slot_rate, night_slot_rate FROM default_rates`,
        []
      ),
    ]);

    const pricingRule = pricingRuleResult.rows[0] || null;
    const ratesMap = {};
    for (const r of defaultRatesResult.rows) ratesMap[r.day_type] = r;

    if (!ratesMap.weekday || !ratesMap.weekend) {
      await client.query('ROLLBACK');
      return res.status(503).json({
        success: false,
        error: 'Pricing configuration error. Please contact the property.',
      });
    }

    // ── Resolve slot status (re-verify availability) ──────────
    const dateObj = new Date(bookingDate + 'T12:00:00+05:30');
    const slotStatus = resolveSlotStatus({
      date: dateObj,
      slot,
      confirmedBooking: null, // Already checked above with FOR UPDATE
      pendingBooking: null,
      pricingRule,
      weekdayRates: ratesMap.weekday,
      weekendRates: ratesMap.weekend,
    });

    if (!slotStatus.available) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        error: `This date/slot is not available for booking (${slotStatus.reason}).`,
        reason: slotStatus.reason,
      });
    }

    // ── Generate unique reference ID ──────────────────────────
    const refId = await generateUniqueRefId(client);

    // ── Snapshot the rate ─────────────────────────────────────
    const rateApplied = slotStatus.rate;
    const rateLabel = slotStatus.rateLabel;

    // ── Insert booking ────────────────────────────────────────
    const insertResult = await client.query(
      `INSERT INTO bookings (
         id, guest_name, guest_phone, guest_email, guest_count,
         occasion, notes, booking_date, slot,
         rate_applied, rate_label, status, policy_agreed, created_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11, 'PENDING', $12, NOW()
       )
       RETURNING id, guest_name, guest_phone, booking_date, slot,
                 rate_applied, rate_label, status, created_at`,
      [
        refId,
        body.guest_name.trim(),
        body.guest_phone.trim(),
        body.guest_email ? body.guest_email.trim().toLowerCase() : null,
        parseInt(body.guest_count, 10),
        body.occasion ? body.occasion.trim() : null,
        body.notes ? body.notes.trim() : null,
        bookingDate,
        slot,
        rateApplied,
        rateLabel,
        body.policy_agreed === true || body.policy_agreed === 'true',
      ]
    );

    await client.query('COMMIT');

    const newBooking = insertResult.rows[0];

    // ── Fire-and-forget WhatsApp notifications ────────────────
    notifyManager(newBooking);
    notifyGuest(newBooking);

    return res.status(201).json({
      success: true,
      message: 'Booking request submitted successfully. Your slot is on hold.',
      referenceId: newBooking.id,
      booking: {
        id: newBooking.id,
        status: newBooking.status,
        booking_date: newBooking.booking_date,
        slot: newBooking.slot,
        rate_applied: parseFloat(newBooking.rate_applied),
        rate_label: newBooking.rate_label,
        created_at: newBooking.created_at,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});

    // Handle DB-level unique violation (safety net)
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'This slot was just booked by another guest. Please choose a different option.',
      });
    }

    // Handle exclusion constraint violation
    if (err.code === '23P01') {
      return res.status(409).json({
        success: false,
        error: 'This slot is no longer available. Please choose a different date or slot.',
      });
    }

    throw err; // Let global error handler deal with it
  } finally {
    client.release();
  }
}

/**
 * GET /api/bookings/:refId
 * Returns booking status for the polling page.
 */
async function getBookingStatus(req, res) {
  const { refId } = req.params;

  // Validate ref ID format
  if (!refId || !/^GRN-\d{4}-\d{4}$/.test(refId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid reference ID format. Expected: GRN-YYYY-XXXX',
    });
  }

  const result = await query(
    `SELECT id, guest_name, booking_date, slot,
            rate_applied, rate_label, status,
            created_at, confirmed_at, released_at,
            occasion, guest_count
     FROM bookings
     WHERE id = $1`,
    [refId]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({
      success: false,
      error: 'Booking not found. Please check your reference ID.',
    });
  }

  const booking = result.rows[0];

  return res.status(200).json({
    success: true,
    booking: {
      id: booking.id,
      status: booking.status,
      guest_name: booking.guest_name,
      booking_date: booking.booking_date,
      slot: booking.slot,
      rate_applied: parseFloat(booking.rate_applied),
      rate_label: booking.rate_label,
      guest_count: booking.guest_count,
      occasion: booking.occasion,
      created_at: booking.created_at,
      confirmed_at: booking.confirmed_at,
      released_at: booking.released_at,
    },
  });
}

/**
 * PATCH /api/bookings/:refId/cancel
 * Guest-initiated cancellation. Only PENDING bookings can be cancelled by guest.
 */
async function cancelBooking(req, res) {
  const { refId } = req.params;

  if (!refId || !/^GRN-\d{4}-\d{4}$/.test(refId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid reference ID format.',
    });
  }

  const result = await query(
    `UPDATE bookings
     SET status = 'CANCELLED', released_at = NOW()
     WHERE id = $1 AND status = 'PENDING'
     RETURNING id, status, released_at`,
    [refId]
  );

  if (result.rowCount === 0) {
    // Check if booking exists at all
    const existing = await query('SELECT id, status FROM bookings WHERE id = $1', [refId]);
    if (existing.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Booking not found.' });
    }
    const currentStatus = existing.rows[0].status;
    return res.status(409).json({
      success: false,
      error: `Cannot cancel a booking with status: ${currentStatus}. Only PENDING bookings can be cancelled.`,
      currentStatus,
    });
  }

  return res.status(200).json({
    success: true,
    message: 'Booking cancelled successfully.',
    booking: result.rows[0],
  });
}

module.exports = { createBooking, getBookingStatus, cancelBooking };
