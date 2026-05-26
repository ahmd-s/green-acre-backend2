'use strict';

/**
 * db/seed.js
 *
 * Master seed runner.
 * Executes all seed files in order:
 *   001_default_rates.sql       — weekday/weekend base rates
 *   002_peak_pricing_2025.sql   — holiday and peak date pricing
 *   003_policy_content.sql      — guest policy text
 *   004_admin_user.js           — admin account (requires ADMIN_USERNAME + ADMIN_PASSWORD)
 *
 * All SQL seeds use INSERT ... ON CONFLICT DO UPDATE (upsert) so this
 * script is idempotent and safe to re-run.
 *
 * Usage:
 *   ADMIN_USERNAME=manager ADMIN_PASSWORD=YourPass123! node db/seed.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, connectDB, closeDB } = require('../config/db');

const SEEDS_DIR = path.join(__dirname, 'seeds');

async function runSeeds() {
  console.log('[Seed] Starting database seeding...');

  try {
    await connectDB();

    // Run SQL seeds in order.
    const sqlFiles = fs
      .readdirSync(SEEDS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of sqlFiles) {
      const filePath = path.join(SEEDS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log(`[Seed] Running: ${file}`);
      await query(sql);
      console.log(`[Seed] ✓ ${file}`);
    }

    console.log('[Seed] SQL seeds complete.');
  } catch (err) {
    console.error('[Seed] SQL seed failed:', err.message);
    process.exit(1);
  } finally {
    await closeDB();
  }

  // Run the admin user JS seed separately (needs its own DB connection).
  console.log('[Seed] Running admin user seed...');
  try {
    require('./seeds/004_admin_user.js');
    // 004_admin_user.js manages its own connection and process exit.
  } catch (err) {
    console.error('[Seed] Admin user seed failed:', err.message);
    process.exit(1);
  }
}

runSeeds();
