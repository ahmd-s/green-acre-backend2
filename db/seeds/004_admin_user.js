'use strict';

/**
 * db/seeds/004_admin_user.js
 *
 * Creates the initial admin user for The Green Acre manager panel.
 *
 * This seed is run as a Node.js script (not SQL) because it needs to
 * bcrypt-hash the password before writing it to the database.
 * Passwords are NEVER stored in plaintext.
 *
 * Usage:
 *   ADMIN_USERNAME=manager ADMIN_PASSWORD=YourStrongPass123! node db/seeds/004_admin_user.js
 *
 * Or, when called via seed.js, set ADMIN_USERNAME and ADMIN_PASSWORD in .env.
 *
 * Security requirements:
 *   - Minimum 12 bcrypt rounds (as per masterplan Section 5.4)
 *   - Password is read from environment — never hardcoded
 *   - Uses upsert so the seed can be re-run to rotate credentials
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, connectDB, closeDB } = require('../config/db');

const BCRYPT_ROUNDS = 12;

async function seedAdminUser() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.error(
      '[Seed] ERROR: ADMIN_USERNAME and ADMIN_PASSWORD must be set in .env before running this seed.'
    );
    console.error('[Seed] Example:');
    console.error('[Seed]   ADMIN_USERNAME=manager');
    console.error('[Seed]   ADMIN_PASSWORD=YourStrongPass123!');
    process.exit(1);
  }

  if (password.length < 12) {
    console.error('[Seed] ERROR: ADMIN_PASSWORD must be at least 12 characters.');
    process.exit(1);
  }

  console.log(`[Seed] Hashing password for "${username}" with ${BCRYPT_ROUNDS} bcrypt rounds...`);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  console.log('[Seed] Password hashed successfully.');

  const sql = `
    INSERT INTO admins (username, password_hash)
    VALUES ($1, $2)
    ON CONFLICT (username)
    DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      last_login    = NULL
    RETURNING id, username, created_at
  `;

  try {
    await connectDB();
    const result = await query(sql, [username, passwordHash]);
    const admin = result.rows[0];
    console.log(`[Seed] Admin user created/updated:`);
    console.log(`[Seed]   ID:       ${admin.id}`);
    console.log(`[Seed]   Username: ${admin.username}`);
    console.log(`[Seed]   Created:  ${admin.created_at}`);
    console.log('[Seed] Admin seed complete.');
  } catch (err) {
    console.error('[Seed] Failed to seed admin user:', err.message);
    process.exit(1);
  } finally {
    await closeDB();
  }
}

seedAdminUser();
