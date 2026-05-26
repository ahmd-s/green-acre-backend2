-- ============================================================
--  Seed 001: default_rates
--
--  Baseline rates per the masterplan:
--    Weekday (Mon–Thu): Day ₹6,000 | Night ₹7,000
--    Weekend (Fri–Sun): Day ₹7,500 | Night ₹9,000
--
--  Uses INSERT ... ON CONFLICT DO UPDATE (upsert) so this seed
--  can be re-run safely without creating duplicate rows.
-- ============================================================

INSERT INTO default_rates (day_type, day_slot_rate, night_slot_rate)
VALUES
  ('weekday', 6000.00, 7000.00),
  ('weekend', 7500.00, 9000.00)
ON CONFLICT (day_type)
DO UPDATE SET
  day_slot_rate   = EXCLUDED.day_slot_rate,
  night_slot_rate = EXCLUDED.night_slot_rate,
  updated_at      = NOW();
