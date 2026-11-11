-- 0013_staff_upi: each employee reports the UPI money they collected today as a running total
-- ("total so far"; the latest figure counts). The pump has ONE Paytm QR, so these are self-reported:
-- at End day their sum is cross-checked against the Paytm app's total for the day.
-- Also: which screen a login opens (phone view with two options, or the full register).

ALTER TABLE users ADD COLUMN home_view TEXT NOT NULL DEFAULT 'register' CHECK (home_view IN ('register','simple'));

CREATE TABLE staff_upi_totals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id),
  business_date    DATE NOT NULL,
  user_id          UUID NOT NULL REFERENCES users(id),
  amount           NUMERIC(14,2) NOT NULL CHECK (amount >= 0 AND amount < 100000000),
  at               TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  idempotency_key  TEXT NOT NULL UNIQUE
);
CREATE INDEX staff_upi_totals_day ON staff_upi_totals (site_id, business_date, user_id, at DESC);
SELECT make_fact_table('staff_upi_totals');
CREATE TRIGGER staff_upi_total_guard BEFORE INSERT ON staff_upi_totals FOR EACH ROW EXECUTE FUNCTION trg_cash_count_guard();

CREATE VIEW v_staff_upi_totals AS
SELECT DISTINCT ON (t.site_id, t.business_date, t.user_id) t.site_id, t.business_date, t.user_id, u.name, t.amount, t.at
FROM staff_upi_totals t JOIN users u ON u.id = t.user_id
ORDER BY t.site_id, t.business_date, t.user_id, t.at DESC;
GRANT SELECT ON v_staff_upi_totals TO pump_app, pump_backup;

INSERT INTO settings (key, value, description) VALUES
  ('repeat_entry_minutes', '"10"', 'Ask before saving the same customer + amount + type again within this many minutes')
ON CONFLICT (key) DO NOTHING;
