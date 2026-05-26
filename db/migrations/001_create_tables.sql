-- ============================================================
--  THE GREEN ACRE — Database Schema
--  Migration 001: Create all tables
--
--  Run via:  node db/migrate.js
--
--  Design decisions:
--    • bookings.id is a VARCHAR reference (GRN-YYYY-XXXX), not SERIAL,
--      because the human-readable ref ID is the primary identifier guests see.
--    • rate_applied is snapshotted at booking time so pricing changes
--      do not retroactively alter confirmed bookings.
--    • pricing_rules has a UNIQUE constraint on target_date so there is
--      never ambiguity about which rule applies to a date.
--    • policy_content uses section_key as the natural key; the INTEGER id
--      is kept for ORM compatibility if ever needed.
--    • All timestamps are TIMESTAMPTZ (with timezone). The DB session is
--      set to Asia/Kolkata (IST) so NOW() returns IST time.
--    • Indexes are added on the columns used in WHERE clauses of the
--      most frequent queries (calendar assembly, status polling).
-- ============================================================

-- ── Enable necessary extensions ───────────────────────────────
-- pgcrypto is not required now but useful for future UUID generation.
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. bookings ───────────────────────────────────────────────
-- One row per booking request. Status transitions:
--   PENDING → CONFIRMED  (manager confirms after deposit)
--   PENDING → RELEASED   (manager releases hold, or auto-release cron)
--   CONFIRMED → RELEASED (manager cancels a confirmed booking — rare)
--   Any status → CANCELLED (future: guest-initiated cancellation)

CREATE TABLE IF NOT EXISTS bookings (
  -- Human-readable reference, e.g. GRN-2025-3841
  id                VARCHAR(20)   PRIMARY KEY,

  -- Guest identity
  guest_name        VARCHAR(120)  NOT NULL,
  guest_phone       VARCHAR(20)   NOT NULL,
  guest_email       VARCHAR(120),                  -- optional per masterplan
  guest_count       INTEGER       NOT NULL CHECK (guest_count BETWEEN 1 AND 200),
  occasion          VARCHAR(80),
  notes             TEXT,

  -- Slot details
  booking_date      DATE          NOT NULL,
  slot              VARCHAR(10)   NOT NULL CHECK (slot IN ('day', 'night')),

  -- Pricing snapshot — frozen at submission time
  rate_applied      DECIMAL(10,2) NOT NULL CHECK (rate_applied > 0),
  rate_label        VARCHAR(20)   NOT NULL CHECK (rate_label IN ('NORMAL', 'WEEKEND', 'PEAK')),

  -- Lifecycle
  status            VARCHAR(20)   NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'CONFIRMED', 'RELEASED', 'CANCELLED')),
  policy_agreed     BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Timestamps (stored with timezone; session TZ = IST)
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  confirmed_at      TIMESTAMPTZ,                   -- set when manager confirms
  released_at       TIMESTAMPTZ,                   -- set when booking is released

  -- Constraint: a date+slot combination can only have ONE active booking
  -- (PENDING or CONFIRMED). RELEASED/CANCELLED slots are freed.
  -- This is enforced at the application layer with a SELECT FOR UPDATE transaction,
  -- but the partial unique index below provides a database-level safety net.
  CONSTRAINT unique_active_booking
    EXCLUDE USING btree (booking_date WITH =, slot WITH =)
    WHERE (status IN ('PENDING', 'CONFIRMED'))
    -- NOTE: EXCLUDE requires btree_gist extension. If unavailable, remove
    -- this constraint and rely solely on the application-layer lock.
    -- The migration script handles this gracefully (see migrate.js).
);

-- Fast lookup by reference ID (already PK, covered)
-- Fast lookup for booking-status polling
CREATE INDEX IF NOT EXISTS idx_bookings_status
  ON bookings (status);

-- Calendar assembly query: WHERE booking_date = $1 AND status IN ('PENDING','CONFIRMED')
CREATE INDEX IF NOT EXISTS idx_bookings_date_status
  ON bookings (booking_date, status);

-- Admin queue: ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_bookings_created_at
  ON bookings (created_at DESC);


-- ── 2. pricing_rules ─────────────────────────────────────────
-- Per-date pricing overrides. When a date has no rule, the backend
-- falls back to default_rates based on day of week (Sat/Sun = weekend).
-- is_closed = true means the date is a blackout/blocked date.

CREATE TABLE IF NOT EXISTS pricing_rules (
  id              SERIAL        PRIMARY KEY,
  target_date     DATE          NOT NULL,
  label_name      VARCHAR(20)   NOT NULL
                    CHECK (label_name IN ('NORMAL', 'WEEKEND', 'HOLI', 'DIWALI', 'EID', 'PEAK', 'CUSTOM')),
  day_slot_rate   DECIMAL(10,2) CHECK (day_slot_rate > 0),
  night_slot_rate DECIMAL(10,2) CHECK (night_slot_rate > 0),
  is_closed       BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- One rule per date. Prevents ambiguous priority resolution.
  CONSTRAINT unique_pricing_rule_per_date UNIQUE (target_date)
);

-- Calendar assembly query
CREATE INDEX IF NOT EXISTS idx_pricing_rules_date
  ON pricing_rules (target_date);

-- Admin rate manager: fetch by month
CREATE INDEX IF NOT EXISTS idx_pricing_rules_month
  ON pricing_rules (DATE_TRUNC('month', target_date::timestamp));


-- ── 3. default_rates ─────────────────────────────────────────
-- Exactly 2 rows: one for weekday (Mon–Thu), one for weekend (Fri–Sun).
-- Note: the masterplan specifies weekday = Mon–Thu, weekend = Fri–Sun.
-- This is broader than typical Sat–Sun weekends, intentional for the property.
-- These rows are seeded once and only updated, never inserted or deleted.

CREATE TABLE IF NOT EXISTS default_rates (
  id              SERIAL        PRIMARY KEY,
  day_type        VARCHAR(10)   NOT NULL UNIQUE
                    CHECK (day_type IN ('weekday', 'weekend')),
  day_slot_rate   DECIMAL(10,2) NOT NULL CHECK (day_slot_rate > 0),
  night_slot_rate DECIMAL(10,2) NOT NULL CHECK (night_slot_rate > 0),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);


-- ── 4. policy_content ────────────────────────────────────────
-- 4 editable policy sections displayed in the guest-facing Policy Modal.
-- Edited by the manager via the Admin Rules Editor (Screen 11).
-- section_key is an application-enforced enum — the PUT endpoint validates
-- against this list and returns 404 for unknown keys.

CREATE TABLE IF NOT EXISTS policy_content (
  id              SERIAL        PRIMARY KEY,
  section_key     VARCHAR(40)   NOT NULL UNIQUE
                    CHECK (section_key IN ('checkout_policy', 'cleanliness', 'pool_safety', 'house_rules')),
  content_text    TEXT          NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);


-- ── 5. admins ────────────────────────────────────────────────
-- Typically a single row (the property manager).
-- Passwords are stored as bcrypt hashes (min 12 rounds).
-- Plaintext passwords are NEVER stored, logged, or returned by any API.

CREATE TABLE IF NOT EXISTS admins (
  id              SERIAL        PRIMARY KEY,
  username        VARCHAR(60)   NOT NULL UNIQUE,
  password_hash   VARCHAR(255)  NOT NULL,
  last_login      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Fast login lookup
CREATE INDEX IF NOT EXISTS idx_admins_username
  ON admins (username);


-- ── Comments on tables (PostgreSQL COMMENT syntax) ───────────
COMMENT ON TABLE bookings        IS 'Guest booking requests and their lifecycle status.';
COMMENT ON TABLE pricing_rules   IS 'Per-date pricing overrides. Falls back to default_rates if no rule exists.';
COMMENT ON TABLE default_rates   IS 'Baseline weekday/weekend rates. Exactly 2 rows, never deleted.';
COMMENT ON TABLE policy_content  IS 'Guest-facing policy text, editable by the admin.';
COMMENT ON TABLE admins          IS 'Admin accounts for the manager control panel.';

COMMENT ON COLUMN bookings.rate_applied IS 'Rate in INR snapshotted at booking time. Never changes after creation.';
COMMENT ON COLUMN bookings.slot         IS 'day = 8AM–8PM | night = 8PM–8AM next day';
COMMENT ON COLUMN pricing_rules.is_closed IS 'TRUE = blackout date. Guests cannot select this date regardless of rates.';
