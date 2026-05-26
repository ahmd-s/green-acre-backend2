-- ============================================================
--  Seed 002: pricing_rules — Peak dates for 2025
--
--  Covers: Holi, Eid al-Fitr, Eid al-Adha, Diwali, Christmas,
--          New Year's Eve/Day, and long weekends.
--
--  Rates are indicative — the manager should review and adjust
--  via the Admin Rate Manager (Screen 10) after launch.
--
--  Peak rates: Day ₹10,000 | Night ₹12,000 (≈1.5–1.7x weekend)
--
--  Uses upsert so this seed can be re-run without errors.
-- ============================================================

INSERT INTO pricing_rules (target_date, label_name, day_slot_rate, night_slot_rate, is_closed)
VALUES

  -- ── Holi 2025 (14 March — Holi; 13 March — Holika Dahan) ───
  ('2025-03-13', 'HOLI', 10000.00, 12000.00, FALSE),
  ('2025-03-14', 'HOLI', 10000.00, 12000.00, FALSE),
  ('2025-03-15', 'HOLI', 10000.00, 12000.00, FALSE),  -- recovery day

  -- ── Eid al-Fitr 2025 (30–31 March, approximate) ─────────────
  ('2025-03-29', 'EID',  10000.00, 12000.00, FALSE),
  ('2025-03-30', 'EID',  10000.00, 12000.00, FALSE),
  ('2025-03-31', 'EID',  10000.00, 12000.00, FALSE),

  -- ── Good Friday + Easter long weekend (18–21 April) ─────────
  ('2025-04-18', 'PEAK', 10000.00, 12000.00, FALSE),
  ('2025-04-19', 'PEAK', 10000.00, 12000.00, FALSE),
  ('2025-04-20', 'PEAK', 10000.00, 12000.00, FALSE),
  ('2025-04-21', 'PEAK', 10000.00, 12000.00, FALSE),

  -- ── Eid al-Adha 2025 (6–7 June, approximate) ────────────────
  ('2025-06-06', 'EID',  10000.00, 12000.00, FALSE),
  ('2025-06-07', 'EID',  10000.00, 12000.00, FALSE),
  ('2025-06-08', 'EID',  10000.00, 12000.00, FALSE),

  -- ── Independence Day long weekend (15 August) ────────────────
  ('2025-08-15', 'PEAK', 9000.00, 11000.00, FALSE),
  ('2025-08-16', 'PEAK', 9000.00, 11000.00, FALSE),
  ('2025-08-17', 'PEAK', 9000.00, 11000.00, FALSE),

  -- ── Gandhi Jayanti long weekend (2 October) ──────────────────
  ('2025-10-02', 'PEAK', 9000.00, 11000.00, FALSE),
  ('2025-10-03', 'PEAK', 9000.00, 11000.00, FALSE),
  ('2025-10-04', 'PEAK', 9000.00, 11000.00, FALSE),
  ('2025-10-05', 'PEAK', 9000.00, 11000.00, FALSE),

  -- ── Diwali 2025 (20 October — Diwali; 19–22 October window) ─
  ('2025-10-19', 'DIWALI', 12000.00, 14000.00, FALSE),
  ('2025-10-20', 'DIWALI', 12000.00, 14000.00, FALSE),
  ('2025-10-21', 'DIWALI', 12000.00, 14000.00, FALSE),
  ('2025-10-22', 'DIWALI', 12000.00, 14000.00, FALSE),
  ('2025-10-23', 'DIWALI', 12000.00, 14000.00, FALSE),

  -- ── Christmas 2025 ───────────────────────────────────────────
  ('2025-12-24', 'PEAK', 10000.00, 12000.00, FALSE),
  ('2025-12-25', 'PEAK', 10000.00, 12000.00, FALSE),
  ('2025-12-26', 'PEAK', 10000.00, 12000.00, FALSE),
  ('2025-12-27', 'PEAK', 10000.00, 12000.00, FALSE),

  -- ── New Year 2025–2026 ───────────────────────────────────────
  ('2025-12-28', 'PEAK', 10000.00, 12000.00, FALSE),
  ('2025-12-29', 'PEAK', 10000.00, 12000.00, FALSE),
  ('2025-12-30', 'PEAK', 10000.00, 12000.00, FALSE),
  ('2025-12-31', 'PEAK', 14000.00, 16000.00, FALSE),  -- NYE premium
  ('2026-01-01', 'PEAK', 12000.00, 14000.00, FALSE),
  ('2026-01-02', 'PEAK', 10000.00, 12000.00, FALSE),
  ('2026-01-03', 'PEAK', 10000.00, 12000.00, FALSE),

  -- ── Holi 2026 (early March 2026, approximate) ────────────────
  ('2026-03-02', 'HOLI', 10000.00, 12000.00, FALSE),
  ('2026-03-03', 'HOLI', 10000.00, 12000.00, FALSE),
  ('2026-03-04', 'HOLI', 10000.00, 12000.00, FALSE)

ON CONFLICT (target_date)
DO UPDATE SET
  label_name      = EXCLUDED.label_name,
  day_slot_rate   = EXCLUDED.day_slot_rate,
  night_slot_rate = EXCLUDED.night_slot_rate,
  is_closed       = EXCLUDED.is_closed,
  updated_at      = NOW();
