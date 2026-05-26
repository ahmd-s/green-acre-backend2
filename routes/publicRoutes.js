'use strict';

/**
 * routes/publicRoutes.js
 *
 * Public API routes — no authentication required.
 * Mounted at: /api
 *
 * Endpoints:
 *   GET   /api/calendar?month=YYYY-MM        → calendar assembly with 6-step pricing priority
 *   GET   /api/pricing-rules?date=YYYY-MM-DD → single date pricing (admin-facing helper)
 *   GET   /api/policy                        → all 4 policy_content records
 *   POST  /api/bookings/request              → create PENDING booking (collision-safe)
 *   GET   /api/bookings/:refId               → booking status polling
 *   PATCH /api/bookings/:refId/cancel        → guest cancels PENDING booking
 */

const { Router } = require('express');
const { apiRateLimiter } = require('../middleware/rateLimiter');

const { getCalendar } = require('../controllers/calendarController');
const { getPolicy } = require('../controllers/policyController');
const {
  createBooking,
  getBookingStatus,
  cancelBooking,
} = require('../controllers/bookingController');
const { listPricingRules } = require('../controllers/adminPricingController');

const router = Router();

// Apply general rate limiter to all public routes
router.use(apiRateLimiter);

// ── Calendar ──────────────────────────────────────────────────
/**
 * GET /api/calendar?month=YYYY-MM
 * Core endpoint: returns per-day, per-slot availability and pricing.
 * Implements the 6-step pricing priority logic.
 */
router.get('/calendar', getCalendar);

// ── Pricing rules (public read-only for date-specific queries) ─
/**
 * GET /api/pricing-rules?date=YYYY-MM-DD or ?month=YYYY-MM
 * Used by frontend for precise single-date rate confirmation.
 */
router.get('/pricing-rules', listPricingRules);

// ── Policy ────────────────────────────────────────────────────
/**
 * GET /api/policy
 * Returns all policy_content rows for the guest-facing policy modal.
 */
router.get('/policy', getPolicy);

// ── Bookings ──────────────────────────────────────────────────
/**
 * POST /api/bookings/request
 * IMPORTANT: Must be defined BEFORE /api/bookings/:refId to avoid
 * Express matching "request" as a :refId parameter.
 */
router.post('/bookings/request', createBooking);

/**
 * GET /api/bookings/:refId
 * Returns booking status for the polling page.
 * Accepts GRN-YYYY-XXXX format.
 */
router.get('/bookings/:refId', getBookingStatus);

/**
 * PATCH /api/bookings/:refId/cancel
 * Guest-initiated cancellation of PENDING bookings only.
 */
router.patch('/bookings/:refId/cancel', cancelBooking);

module.exports = router;
