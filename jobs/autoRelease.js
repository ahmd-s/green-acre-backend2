'use strict';

/**
 * jobs/autoRelease.js
 *
 * Cron job: automatically releases PENDING bookings that have been
 * waiting beyond the configured hold duration.
 *
 * Default hold duration: 2 hours (configurable via PENDING_HOLD_HOURS env var)
 *
 * This job is designed to run either:
 *   a) Via node-cron (scheduled inside the API process — default)
 *   b) Via Railway Cron Jobs (external scheduler)
 *
 * For option (b), expose the trigger via an internal endpoint and
 * call it from Railway's cron job. See server.js for the internal trigger.
 *
 * Race condition protection:
 *   Uses WHERE status = 'PENDING' in the UPDATE query — if a manager
 *   is confirming a booking at the same time the cron runs, only one
 *   operation will win. The other will find status != 'PENDING' and skip.
 */

const { query } = require('../config/db');

const HOLD_HOURS = parseFloat(process.env.PENDING_HOLD_HOURS || '2');

/**
 * Releases all PENDING bookings older than HOLD_HOURS.
 * Safe to call multiple times (idempotent).
 *
 * @returns {Promise<{ released: number, ids: string[] }>}
 */
async function releaseStaleBookings() {
  const result = await query(
    `UPDATE bookings
     SET status = 'RELEASED', released_at = NOW()
     WHERE status = 'PENDING'
       AND created_at < NOW() - ($1 || ' hours')::INTERVAL
     RETURNING id, guest_name, booking_date, slot, created_at`,
    [HOLD_HOURS]
  );

  const released = result.rowCount;
  const ids = result.rows.map((r) => r.id);

  if (released > 0) {
    console.log(`[AutoRelease] Released ${released} stale PENDING booking(s): ${ids.join(', ')}`);
    for (const row of result.rows) {
      console.log(
        `[AutoRelease]   ${row.id} | ${row.guest_name} | ${row.booking_date} ${row.slot} | held since ${row.created_at}`
      );
    }
  } else {
    console.log('[AutoRelease] No stale bookings to release.');
  }

  return { released, ids };
}

/**
 * Starts the cron job using node-cron.
 * Runs every 15 minutes.
 *
 * Only call this if ENABLE_AUTO_RELEASE_CRON=true in env.
 */
function startAutoReleaseCron() {
  let cron;
  try {
    cron = require('node-cron');
  } catch {
    console.warn('[AutoRelease] node-cron not installed. Auto-release cron will not run.');
    console.warn('[AutoRelease] Install with: npm install node-cron');
    return;
  }

  const schedule = process.env.AUTO_RELEASE_CRON_SCHEDULE || '*/15 * * * *';

  cron.schedule(schedule, async () => {
    console.log(`[AutoRelease] Cron triggered at ${new Date().toISOString()}`);
    try {
      await releaseStaleBookings();
    } catch (err) {
      console.error('[AutoRelease] Cron job error:', err.message);
    }
  });

  console.log(`[AutoRelease] Cron job started. Schedule: "${schedule}". Hold duration: ${HOLD_HOURS}h`);
}

module.exports = { releaseStaleBookings, startAutoReleaseCron };
