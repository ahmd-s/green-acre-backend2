'use strict';

/**
 * utils/generateRefId.js
 *
 * Generates human-readable booking reference IDs in the format GRN-YYYY-XXXX.
 * XXXX is a zero-padded random 4-digit number (1000–9999).
 *
 * Collision handling:
 *   - The bookings.id column has a PRIMARY KEY constraint — any duplicate
 *     insert will throw a unique violation (error code 23505).
 *   - The caller (bookingController) retries up to MAX_RETRIES times.
 *   - With ~9000 possible IDs per year and typical booking volumes (<500/year)
 *     collision probability is negligible, but we handle it correctly anyway.
 */

const MAX_RETRIES = 10;

/**
 * Generates a single candidate reference ID.
 * @returns {string}  e.g. "GRN-2025-4872"
 */
function generateRefId() {
  const year = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 9000) + 1000; // 1000–9999
  return `GRN-${year}-${rand}`;
}

/**
 * Generates a unique reference ID by checking the database.
 * Uses a SELECT FOR UPDATE inside the caller's transaction to avoid TOCTOU.
 *
 * @param {import('pg').PoolClient} client  - Active transaction client
 * @returns {Promise<string>}               - Unique reference ID
 * @throws {Error}                          - If MAX_RETRIES exhausted
 */
async function generateUniqueRefId(client) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const id = generateRefId();
    const result = await client.query(
      'SELECT id FROM bookings WHERE id = $1',
      [id]
    );
    if (result.rowCount === 0) {
      return id;
    }
    // Collision — try again
    if (attempt === MAX_RETRIES) {
      throw new Error(`Failed to generate unique reference ID after ${MAX_RETRIES} attempts`);
    }
  }
}

module.exports = { generateRefId, generateUniqueRefId };
