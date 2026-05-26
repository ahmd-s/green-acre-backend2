'use strict';

/**
 * db/migrate.js
 *
 * Runs all SQL migration files in order against the configured database.
 *
 * Handles the btree_gist extension gracefully:
 *   The EXCLUDE constraint in bookings (which enforces one active booking per
 *   date+slot at the DB level) requires the btree_gist extension. If it is not
 *   available (e.g. on managed Railway PostgreSQL instances that restrict
 *   extensions), the EXCLUDE constraint is skipped and a warning is printed.
 *   Application-layer locking (SELECT FOR UPDATE in the booking transaction)
 *   remains in force as the primary guard.
 *
 * Usage:
 *   node db/migrate.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, connectDB, closeDB } = require('./config/db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function runMigrations() {
  console.log('[Migrate] Starting database migration...');

  try {
    await connectDB();

    // 1. Attempt to enable btree_gist for the EXCLUDE constraint.
    //    This is a best-effort step — we continue even if it fails.
    try {
      await query('CREATE EXTENSION IF NOT EXISTS btree_gist');
      console.log('[Migrate] btree_gist extension enabled (EXCLUDE constraint active).');
    } catch (extErr) {
      console.warn(
        '[Migrate] WARNING: Could not enable btree_gist extension.',
        'The EXCLUDE constraint on bookings will not be active.',
        'Application-layer SELECT FOR UPDATE locking is still enforced.',
        '\n[Migrate] Extension error:', extErr.message
      );
    }

    // 2. Read migration files in alphabetical order.
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('[Migrate] No migration files found.');
      return;
    }

    // 3. Execute each migration file.
    for (const file of files) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      console.log(`[Migrate] Running: ${file}`);
      try {
        await query(sql);
        console.log(`[Migrate] ✓ ${file}`);
      } catch (err) {
        // If the EXCLUDE constraint fails due to missing extension,
        // strip it and re-run the file.
        if (
          err.message.includes('btree_gist') ||
          err.message.includes('EXCLUDE') ||
          err.code === '0A000'
        ) {
          console.warn(
            `[Migrate] EXCLUDE constraint failed in ${file}. Retrying without it...`
          );
          const sqlWithoutExclude = sql
            .replace(/,?\s*CONSTRAINT unique_active_booking[\s\S]*?(?=\))/m, '')
            .trim();
          await query(sqlWithoutExclude);
          console.log(`[Migrate] ✓ ${file} (without EXCLUDE constraint)`);
        } else {
          throw err;
        }
      }
    }

    console.log('[Migrate] All migrations completed successfully.');
  } catch (err) {
    console.error('[Migrate] Migration failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await closeDB();
  }
}

runMigrations();
