'use strict';

/**
 * routes/adminRoutes.js
 *
 * Admin API routes — ALL protected by JWT authentication middleware.
 * Mounted at: /api/admin
 *
 * The requireAuth middleware is applied at router level — every route
 * below is impossible to reach without a valid Bearer token.
 */

const { Router } = require('express');
const { requireAuth } = require('../middleware/authMiddleware');

const { getStats } = require('../controllers/adminStatsController');
const {
  listBookings,
  confirmBooking,
  releaseBooking,
} = require('../controllers/adminBookingController');
const {
  listPricingRules,
  createPricingRule,
  updatePricingRule,
  deletePricingRule,
  getDefaultRates,
  updateDefaultRate,
} = require('../controllers/adminPricingController');
const { getAdminPolicy, updatePolicy } = require('../controllers/adminPolicyController');

const router = Router();

// ── Apply JWT guard to ALL routes ─────────────────────────────
router.use(requireAuth);

// ── Dashboard stats ───────────────────────────────────────────
router.get('/stats', getStats);

// ── Bookings ──────────────────────────────────────────────────
// IMPORTANT: specific paths (/confirm, /release) BEFORE /:id
router.get('/bookings', listBookings);
router.patch('/bookings/:id/confirm', confirmBooking);
router.patch('/bookings/:id/release', releaseBooking);

// ── Pricing rules ─────────────────────────────────────────────
router.get('/pricing-rules', listPricingRules);
router.post('/pricing-rules', createPricingRule);
router.put('/pricing-rules/:id', updatePricingRule);
router.delete('/pricing-rules/:id', deletePricingRule);

// ── Default rates ─────────────────────────────────────────────
router.get('/default-rates', getDefaultRates);
router.put('/default-rates/:id', updateDefaultRate);

// ── Policy content ────────────────────────────────────────────
router.get('/policy', getAdminPolicy);
router.put('/policy/:sectionKey', updatePolicy);

module.exports = router;
