-- ============================================================
--  Seed 003: policy_content
--
--  4 policy sections displayed in the guest Policy Modal (Screen 6).
--  Content is editable by the manager via Admin Rules Editor (Screen 11).
--  All section_keys must match the CHECK constraint in the schema.
-- ============================================================

INSERT INTO policy_content (section_key, content_text)
VALUES

  ('checkout_policy',
   E'Check-in time is 8:00 AM for Day slots and 8:00 PM for Night slots.\n'
   'Check-out is strictly at the end of your booked slot. Early arrivals and late departures must be pre-approved and may incur additional charges.\n\n'
   'A refundable security deposit of ₹5,000 is collected at check-in. This will be returned within 24 hours of departure, subject to a property inspection.\n\n'
   'Cancellations made more than 72 hours before check-in are eligible for a full refund of the deposit. Cancellations within 72 hours forfeit the deposit.'),

  ('cleanliness',
   E'Guests are expected to maintain the property in the same condition as it was received.\n\n'
   'Please dispose of all garbage in the designated bins provided. Do not leave food waste in the open — this is a farmhouse environment and attracts wildlife.\n\n'
   'All dishes and cooking utensils must be washed and returned to their original locations before departure.\n\n'
   'Any spills, stains, or damage to furniture, linen, or fixtures must be reported to the host immediately. Concealed damage will be billed from the security deposit.'),

  ('pool_safety',
   E'The pool is available exclusively for booked guests during your slot hours.\n\n'
   'Children under 12 must be accompanied by an adult at all times in and around the pool area.\n\n'
   'No glass containers are permitted in the pool area. Please use the plastic cups provided.\n\n'
   'Guests swim at their own risk. The property does not provide a lifeguard. Please do not swim after consuming alcohol.\n\n'
   'The pool closes 30 minutes before the end of your slot to allow for cleaning. Please exit the pool area punctually.'),

  ('house_rules',
   E'Maximum occupancy for this property is stated at the time of booking. Exceeding the declared guest count is not permitted and may result in immediate eviction without refund.\n\n'
   'Music and amplified sound must be kept at a reasonable volume. Loud music after 10:00 PM is not permitted out of respect for neighbouring properties.\n\n'
   'No pets are allowed on the premises without prior written approval from the host.\n\n'
   'Smoking is not permitted inside any structure on the property. A designated outdoor smoking area is available.\n\n'
   'The host reserves the right to terminate a booking without refund in the event of property damage, illegal activity, or harassment of staff.')

ON CONFLICT (section_key)
DO UPDATE SET
  content_text = EXCLUDED.content_text,
  updated_at   = NOW();
