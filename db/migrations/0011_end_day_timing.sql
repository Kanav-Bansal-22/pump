-- 0011_end_day_timing: a business day (8 AM -> 8 AM) may only be ended from the start of the next
-- morning's closing window (cut-over - closing_window_before_hours, i.e. 05:00 next day).
-- Found in testing: ending day D at 11 PM blocked every udhari entry until 8 AM, although those
-- hours still belong to day D.
INSERT INTO settings (key, value, description) VALUES
  ('end_day_from_next_morning', 'true', 'A day can be ended only from the next morning''s closing window (05:00)')
ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION can_end_business_day(p_site UUID, p_date DATE) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT NOT COALESCE((SELECT value = 'true'::jsonb FROM settings WHERE key = 'end_day_from_next_morning'), true)
      OR (now() AT TIME ZONE s.timezone) >= (p_date + 1) + s.day_cutover
           - make_interval(hours => COALESCE((SELECT (value #>> '{}')::int FROM settings WHERE key = 'closing_window_before_hours'), 3))
  FROM sites s WHERE s.id = p_site
$$;
