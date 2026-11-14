-- 0016_worker_qr: each worker has their own Paytm QR (Paytm business day 8 AM to 8 AM, same as ours).
-- At End day the owner types each QR's total from the Paytm Business app; their sum is the day's UPI
-- total (written to day_collections as before), and each worker's QR is checked against the payments
-- they typed on their phone. user_id NULL = the shop's own QR (not a worker's).
-- Typing each payment on the phone can be switched off (setting staff_type_each_upi).

ALTER TABLE users ADD COLUMN own_qr BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE day_qr_totals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id),
  business_date    DATE NOT NULL,
  user_id          UUID REFERENCES users(id),
  amount           NUMERIC(14,2) NOT NULL CHECK (amount >= 0 AND amount < 100000000),
  entered_by       UUID NOT NULL REFERENCES users(id),
  at               TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  idempotency_key  TEXT NOT NULL
);
CREATE INDEX day_qr_totals_day ON day_qr_totals (site_id, business_date, user_id, at DESC);
SELECT make_fact_table('day_qr_totals');
CREATE TRIGGER day_qr_total_guard BEFORE INSERT ON day_qr_totals FOR EACH ROW EXECUTE FUNCTION trg_cash_count_guard();

-- latest figure per (day, QR) counts; a corrected figure is a new row
CREATE VIEW v_day_qr_totals AS
SELECT DISTINCT ON (q.site_id, q.business_date, q.user_id) q.site_id, q.business_date, q.user_id, COALESCE(u.name, 'Shop QR') AS name, q.amount, q.at
FROM day_qr_totals q LEFT JOIN users u ON u.id = q.user_id
ORDER BY q.site_id, q.business_date, q.user_id, q.at DESC;
GRANT SELECT ON v_day_qr_totals TO pump_app, pump_backup;

INSERT INTO settings (key, value, description) VALUES
  ('staff_type_each_upi', 'true', 'Workers type each UPI payment on their phone (checked against their own QR at End day)')
ON CONFLICT (key) DO NOTHING;
