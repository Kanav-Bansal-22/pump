-- 0015_staff_card_payments: owner's request (2026-11-12). Employees also enter card payments (card machine)
-- the same way as UPI: each amount, net total per employee on the register, checked against the machine total.

ALTER TABLE staff_upi_payments ADD COLUMN mode TEXT NOT NULL DEFAULT 'UPI' CHECK (mode IN ('UPI','CARD'));

DROP VIEW v_staff_upi_totals;
CREATE VIEW v_staff_upi_totals AS
SELECT p.site_id, p.business_date, p.mode, p.user_id, u.name,
       SUM(p.amount)::numeric(14,2) AS amount, count(*)::int AS payments, max(p.at) AS at
  FROM staff_upi_payments p JOIN users u ON u.id = p.user_id
 WHERE NOT EXISTS (SELECT 1 FROM staff_upi_payment_cancels x WHERE x.payment_id = p.id)
 GROUP BY p.site_id, p.business_date, p.mode, p.user_id, u.name;
GRANT SELECT ON v_staff_upi_totals TO pump_app, pump_backup;
