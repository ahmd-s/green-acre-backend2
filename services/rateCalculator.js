'use strict';

/**
 * services/rateCalculator.js
 *
 * Implements the EXACT 6-step calendar priority logic from the masterplan.
 *
 * Priority (first match wins, evaluated per slot):
 *   1. CONFIRMED booking exists → BOOKED (disabled)
 *   2. PENDING booking exists  → PENDING_HOLD (disabled)
 *   3. pricing_rule.is_closed  → CLOSED (disabled)
 *   4. pricing_rule with PEAK label (HOLI/DIWALI/EID/PEAK/CUSTOM) → PEAK rate
 *   5. No rule, date is Fri/Sat/Sun → WEEKEND rate from default_rates
 *   6. All else → WEEKDAY rate from default_rates
 *
 * Note on weekday definition (from schema comment):
 *   weekday = Mon–Thu, weekend = Fri–Sun (broader than typical Sat-Sun)
 *
 * This service is PURE — it takes pre-fetched data and returns structured
 * objects. No DB calls inside this module — all queries happen in the controller.
 */

/** Day-of-week numbers that map to "weekend" (0=Sun, 5=Fri, 6=Sat) */
const WEEKEND_DAYS = new Set([0, 5, 6]); // Sun, Fri, Sat

/** Labels that trigger PEAK pricing */
const PEAK_LABELS = new Set(['HOLI', 'DIWALI', 'EID', 'PEAK', 'CUSTOM']);

/**
 * Determines the status and rate for a single date+slot combination.
 *
 * @param {Object} params
 * @param {Date}   params.date         - The date being evaluated
 * @param {string} params.slot         - 'day' or 'night'
 * @param {Object|null} params.confirmedBooking - Booking row if CONFIRMED exists for this date+slot
 * @param {Object|null} params.pendingBooking  - Booking row if PENDING exists for this date+slot
 * @param {Object|null} params.pricingRule     - pricing_rules row for this date (or null)
 * @param {Object}      params.weekdayRates    - default_rates row for day_type='weekday'
 * @param {Object}      params.weekendRates    - default_rates row for day_type='weekend'
 *
 * @returns {Object} Slot status object
 */
function resolveSlotStatus({
  date,
  slot,
  confirmedBooking,
  pendingBooking,
  pricingRule,
  weekdayRates,
  weekendRates,
}) {
  // ── Priority 1: CONFIRMED booking ────────────────────────────
  if (confirmedBooking) {
    return {
      status: 'BOOKED',
      available: false,
      rate: null,
      rateLabel: null,
      reason: 'booked',
    };
  }

  // ── Priority 2: PENDING booking ──────────────────────────────
  if (pendingBooking) {
    return {
      status: 'PENDING_HOLD',
      available: false,
      rate: null,
      rateLabel: null,
      reason: 'pending_hold',
    };
  }

  // ── Priority 3: Closed/blackout date ─────────────────────────
  if (pricingRule && pricingRule.is_closed) {
    return {
      status: 'CLOSED',
      available: false,
      rate: null,
      rateLabel: null,
      reason: 'closed',
    };
  }

  // ── Priority 4: PEAK pricing rule ────────────────────────────
  if (pricingRule && PEAK_LABELS.has(pricingRule.label_name)) {
    const rate =
      slot === 'day'
        ? parseFloat(pricingRule.day_slot_rate)
        : parseFloat(pricingRule.night_slot_rate);
    return {
      status: 'AVAILABLE',
      available: true,
      rate,
      rateLabel: 'PEAK',
      labelName: pricingRule.label_name,
      reason: 'peak_rule',
    };
  }

  // ── Priority 4b: NORMAL pricing rule (explicit override) ─────
  if (pricingRule && pricingRule.label_name === 'NORMAL') {
    const rate =
      slot === 'day'
        ? parseFloat(pricingRule.day_slot_rate)
        : parseFloat(pricingRule.night_slot_rate);
    return {
      status: 'AVAILABLE',
      available: true,
      rate,
      rateLabel: 'NORMAL',
      labelName: pricingRule.label_name,
      reason: 'normal_rule',
    };
  }

  // ── Priority 5: Weekend default rate ─────────────────────────
  const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  if (WEEKEND_DAYS.has(dayOfWeek)) {
    const rate =
      slot === 'day'
        ? parseFloat(weekendRates.day_slot_rate)
        : parseFloat(weekendRates.night_slot_rate);
    return {
      status: 'AVAILABLE',
      available: true,
      rate,
      rateLabel: 'WEEKEND',
      labelName: 'WEEKEND',
      reason: 'weekend_default',
    };
  }

  // ── Priority 6: Weekday default rate ─────────────────────────
  const rate =
    slot === 'day'
      ? parseFloat(weekdayRates.day_slot_rate)
      : parseFloat(weekdayRates.night_slot_rate);
  return {
    status: 'AVAILABLE',
    available: true,
    rate,
    rateLabel: 'NORMAL',
    labelName: 'WEEKDAY',
    reason: 'weekday_default',
  };
}

/**
 * Assembles the full calendar response for a given month.
 *
 * @param {Object} params
 * @param {number} params.year
 * @param {number} params.month            - 1-based month (1=Jan, 12=Dec)
 * @param {Array}  params.bookings         - All PENDING/CONFIRMED bookings for the month
 * @param {Array}  params.pricingRules     - All pricing_rules rows for the month
 * @param {Object} params.weekdayRates     - default_rates weekday row
 * @param {Object} params.weekendRates     - default_rates weekend row
 *
 * @returns {Array} Array of day objects, one per day in the month
 */
function assembleCalendar({ year, month, bookings, pricingRules, weekdayRates, weekendRates }) {
  // Build lookup maps for O(1) access
  const bookingsByDateSlot = new Map();
  for (const booking of bookings) {
    // booking_date comes as a Date object from pg — normalize to YYYY-MM-DD string
    const dateStr = formatDate(booking.booking_date);
    const key = `${dateStr}:${booking.slot}`;
    if (!bookingsByDateSlot.has(key)) {
      bookingsByDateSlot.set(key, []);
    }
    bookingsByDateSlot.get(key).push(booking);
  }

  const rulesByDate = new Map();
  for (const rule of pricingRules) {
    const dateStr = formatDate(rule.target_date);
    rulesByDate.set(dateStr, rule);
  }

  // Get number of days in the month
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = [];

  for (let day = 1; day <= daysInMonth; day++) {
    // Create date in IST-equivalent — use noon to avoid DST edge cases
    const date = new Date(year, month - 1, day, 12, 0, 0);
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const pricingRule = rulesByDate.get(dateStr) || null;

    // Resolve each slot independently
    const dayBookings = bookingsByDateSlot.get(`${dateStr}:day`) || [];
    const nightBookings = bookingsByDateSlot.get(`${dateStr}:night`) || [];

    const confirmedDay = dayBookings.find((b) => b.status === 'CONFIRMED') || null;
    const pendingDay = dayBookings.find((b) => b.status === 'PENDING') || null;
    const confirmedNight = nightBookings.find((b) => b.status === 'CONFIRMED') || null;
    const pendingNight = nightBookings.find((b) => b.status === 'PENDING') || null;

    const daySlot = resolveSlotStatus({
      date,
      slot: 'day',
      confirmedBooking: confirmedDay,
      pendingBooking: pendingDay,
      pricingRule,
      weekdayRates,
      weekendRates,
    });

    const nightSlot = resolveSlotStatus({
      date,
      slot: 'night',
      confirmedBooking: confirmedNight,
      pendingBooking: pendingNight,
      pricingRule,
      weekdayRates,
      weekendRates,
    });

    // Date-level availability summary
    const fullyBooked = !daySlot.available && !nightSlot.available;
    const partiallyAvailable = daySlot.available !== nightSlot.available;

    days.push({
      date: dateStr,
      dayOfWeek: date.getDay(),
      daySlot,
      nightSlot,
      fullyBooked,
      partiallyAvailable,
      // Convenience for frontend: is this date selectable at all?
      hasAvailability: daySlot.available || nightSlot.available,
    });
  }

  return days;
}

/**
 * Formats a Date or date-string to YYYY-MM-DD.
 * Handles pg returning DATE columns as Date objects.
 *
 * @param {Date|string} d
 * @returns {string}
 */
function formatDate(d) {
  if (typeof d === 'string') {
    // Already a string — strip time component if present
    return d.slice(0, 10);
  }
  if (d instanceof Date) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return String(d).slice(0, 10);
}

module.exports = { resolveSlotStatus, assembleCalendar, formatDate, PEAK_LABELS, WEEKEND_DAYS };
