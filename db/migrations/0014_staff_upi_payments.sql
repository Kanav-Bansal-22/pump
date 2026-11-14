-- 0014_staff_upi_payments: owner's change (2026-11-12). The employee enters EACH amount received on the
-- QR; the register shows the net total per employee (sum of their payments, minus any they cancelled).
-- Replaces the "total so far" reporting of 0013 (that table is kept, no longer used).

CREATE TABLE staff_upi_payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id),
  business_date    DATE NOT NULL,
  user_id          UUID NOT NULL REFERENCES users(id),
  amount           NUMERIC(14,2) NOT NULL CHECK (amount > 0 AND amount < 100000000),
  at               TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  idempotency_key  TEXT NOT NULL UNIQUE
);
CREATE INDEX staff_upi_payments_day ON staff_upi_payments (site_id, business_date, user_id, at DESC);
SELECT make_fact_table('staff_upi_payments');
CREATE TRIGGER staff_upi_payment_guard BEFORE INSERT ON staff_upi_payments FOR EACH ROW EXECUTE FUNCTION trg_cash_count_guard();

-- A wrongly typed amount is cancelled (never deleted): one cancel row per payment.
CREATE TABLE staff_upi_payment_cancels (
  payment_id       UUID PRIMARY KEY REFERENCES staff_upi_payments(id),
  site_id          UUID NOT NULL REFERENCES sites(id),
  business_date    DATE NOT NULL,
  cancelled_by     UUID NOT NULL REFERENCES users(id),
  at               TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  idempotency_key  TEXT NOT NULL UNIQUE
);
SELECT make_fact_table('staff_upi_payment_cancels');
CREATE TRIGGER staff_upi_cancel_guard BEFORE INSERT ON staff_upi_payment_cancels FOR EACH ROW EXECUTE FUNCTION trg_cash_count_guard();

DROP VIEW v_staff_upi_totals;
CREATE VIEW v_staff_upi_totals AS
SELECT p.site_id, p.business_date, p.user_id, u.name,
       SUM(p.amount)::numeric(14,2) AS amount, count(*)::int AS payments, max(p.at) AS at
  FROM staff_upi_payments p JOIN users u ON u.id = p.user_id
 WHERE NOT EXISTS (SELECT 1 FROM staff_upi_payment_cancels x WHERE x.payment_id = p.id)
 GROUP BY p.site_id, p.business_date, p.user_id, u.name;
GRANT SELECT ON v_staff_upi_totals TO pump_app, pump_backup;
