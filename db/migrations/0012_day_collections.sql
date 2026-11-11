-- 0012_day_collections: money received by UPI / Paytm / card / bank / other during the day, as the
-- TOTAL shown on each machine or app (decision D10). The lock subtracts udhari / other receipts already
-- entered in that mode, so the remainder is fuel sold by that mode. Append-only: a corrected total is
-- a new row; the latest row per (day, mode) counts.

CREATE TABLE day_collections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id),
  business_date    DATE NOT NULL,
  mode             TEXT NOT NULL CHECK (mode IN ('UPI','PAYTM','CARD','BANK','OTHER')),
  amount           NUMERIC(14,2) NOT NULL CHECK (amount >= 0 AND amount < 100000000),
  entered_by       UUID NOT NULL REFERENCES users(id),
  at               TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  idempotency_key  TEXT NOT NULL
);
CREATE INDEX day_collections_day ON day_collections (site_id, business_date, mode, at DESC);
SELECT make_fact_table('day_collections');

CREATE TRIGGER day_collection_guard BEFORE INSERT ON day_collections FOR EACH ROW EXECUTE FUNCTION trg_cash_count_guard();

CREATE VIEW v_day_collections AS
SELECT DISTINCT ON (site_id, business_date, mode) site_id, business_date, mode, amount, entered_by, at
FROM day_collections ORDER BY site_id, business_date, mode, at DESC;
GRANT SELECT ON v_day_collections TO pump_app, pump_backup;
