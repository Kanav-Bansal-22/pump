-- 0007_meters: daily rates, cumulative meter chain (append-only, hash-chained), testing fuel,
-- blocked-attempt log, flags, derived segments. Implements addendum v1.1 with corrections D4a/D4b/D4f/D4g.

-- Backup role must be able to dump everything, including future tables.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pump_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO pump_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE pump_owner IN SCHEMA public GRANT SELECT ON TABLES TO pump_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE pump_owner IN SCHEMA public GRANT SELECT ON SEQUENCES TO pump_backup;

INSERT INTO settings (key, value, description) VALUES
  ('closing_window_before_hours', '"3"', 'A reading up to N hours BEFORE the day cut-over closes the business day that is ending'),
  ('closing_window_after_hours', '"3"', 'A reading up to N hours AFTER the day cut-over still closes the previous business day'),
  ('meter_int_digits_default', '"7"', 'Totalizer digits before the decimal point (register photo: 7)'),
  ('meter_decimals_default', '"2"', 'Totalizer digits after the decimal point (register photo: 2)')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Business date of a reading: the day cut-over (e.g. 08:00) +/- a window.
-- A reading taken between (cutover - before) and (cutover + after) on calendar day D closes
-- business day D-1. Outside the window it belongs to the business day in progress.
-- ---------------------------------------------------------------------------
CREATE FUNCTION reading_business_date(p_site UUID, p_at TIMESTAMPTZ) RETURNS DATE LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN local_t::time >= (s.day_cutover - make_interval(hours => before_h))
     AND local_t::time <  (s.day_cutover + make_interval(hours => after_h))
      THEN (local_t::date - 1)
    WHEN local_t::time < s.day_cutover THEN (local_t::date - 1)
    ELSE local_t::date
  END
  FROM sites s,
       LATERAL (SELECT (p_at AT TIME ZONE s.timezone) AS local_t) t,
       LATERAL (SELECT COALESCE((SELECT (value #>> '{}')::int FROM settings WHERE key = 'closing_window_before_hours'), 3) AS before_h,
                       COALESCE((SELECT (value #>> '{}')::int FROM settings WHERE key = 'closing_window_after_hours'), 3) AS after_h) w
  WHERE s.id = p_site
$$;

-- ---------------------------------------------------------------------------
-- Daily rates (owner enters at the 8 AM change). Append-only; the latest row for a
-- (site, fuel, date) is effective. A correction after the day is locked is refused.
-- ---------------------------------------------------------------------------
CREATE TABLE daily_rates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        UUID NOT NULL REFERENCES sites(id),
  fuel_type_id   UUID NOT NULL REFERENCES fuel_types(id),
  business_date  DATE NOT NULL,
  rate           NUMERIC(8,2) NOT NULL CHECK (rate > 0 AND rate < 1000),
  reason         TEXT,                 -- required when replacing an earlier rate for the same day
  set_by         UUID NOT NULL REFERENCES users(id),
  set_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  idempotency_key TEXT UNIQUE
);
CREATE INDEX daily_rates_lookup ON daily_rates (site_id, fuel_type_id, business_date, set_at DESC);
SELECT make_fact_table('daily_rates');

CREATE FUNCTION trg_daily_rate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF lock_business_day_for_posting(NEW.site_id, NEW.business_date) = 'LOCKED' THEN
    RAISE EXCEPTION 'DAY_LOCKED: rates for % cannot change after the day is locked', NEW.business_date USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM daily_rates WHERE site_id = NEW.site_id AND fuel_type_id = NEW.fuel_type_id
              AND business_date = NEW.business_date)
     AND length(trim(COALESCE(NEW.reason, ''))) < 5 THEN
    RAISE EXCEPTION 'A reason is required to change a rate already set for this day';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER daily_rate_guard BEFORE INSERT ON daily_rates FOR EACH ROW EXECUTE FUNCTION trg_daily_rate_guard();

CREATE VIEW v_daily_rates AS
SELECT DISTINCT ON (site_id, fuel_type_id, business_date)
       site_id, fuel_type_id, business_date, rate, set_by, set_at, id AS rate_id
FROM daily_rates
ORDER BY site_id, fuel_type_id, business_date, set_at DESC;

-- ---------------------------------------------------------------------------
-- Meter epochs: one row per physical meter configuration (D4b). Rollover stays in an epoch.
-- ---------------------------------------------------------------------------
CREATE TABLE meter_epochs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nozzle_id    UUID NOT NULL REFERENCES nozzles(id),
  epoch        INT NOT NULL CHECK (epoch >= 1),
  int_digits   SMALLINT NOT NULL CHECK (int_digits BETWEEN 4 AND 9),
  decimals     SMALLINT NOT NULL CHECK (decimals BETWEEN 0 AND 2),
  modulus      NUMERIC(16,2) GENERATED ALWAYS AS (power(10::numeric, int_digits)) STORED,
  meter_serial TEXT,
  created_by   UUID NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (nozzle_id, epoch)
);
SELECT make_fact_table('meter_epochs');

-- ---------------------------------------------------------------------------
-- Meter points: the append-only reading chain.
-- seq = log order (hash chain). Segments are derived in (effective_at, seq) order (D4a).
-- ---------------------------------------------------------------------------
CREATE TABLE meter_points (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nozzle_id        UUID NOT NULL REFERENCES nozzles(id),
  seq              BIGINT NOT NULL,
  epoch            INT NOT NULL,
  wrap_count       INT NOT NULL DEFAULT 0 CHECK (wrap_count >= 0),
  reading          NUMERIC(12,2) NOT NULL CHECK (reading >= 0),
  cumulative       NUMERIC(16,2) NOT NULL,
  point_type       TEXT NOT NULL CHECK (point_type IN
                     ('BASELINE','SHIFT_END','DAY_END','PRICE_CHANGE','ROLLOVER','EVENT_END','EVENT_START','GAP_BOUNDARY')),
  business_date    DATE NOT NULL,
  shift_id         UUID REFERENCES shifts(id),
  taken_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  effective_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  entered_by       UUID NOT NULL REFERENCES users(id),
  device_info      TEXT,
  ip               TEXT,
  photo_id         UUID REFERENCES attachments(id),
  supersedes_id    UUID REFERENCES meter_points(id),
  idempotency_key  TEXT NOT NULL UNIQUE,
  prev_hash        BYTEA,
  row_hash         BYTEA NOT NULL,
  UNIQUE (nozzle_id, seq),
  FOREIGN KEY (nozzle_id, epoch) REFERENCES meter_epochs (nozzle_id, epoch)
);
CREATE INDEX meter_points_order ON meter_points (nozzle_id, effective_at, seq);
-- D4g: one original day-end / shift-end per nozzle per business day (corrections carry supersedes_id).
CREATE UNIQUE INDEX meter_points_one_boundary ON meter_points (nozzle_id, business_date, shift_id)
  NULLS NOT DISTINCT WHERE point_type IN ('SHIFT_END','DAY_END') AND supersedes_id IS NULL;
CREATE UNIQUE INDEX meter_points_one_baseline ON meter_points (nozzle_id) WHERE point_type = 'BASELINE';

-- Canonical text that is hashed. Fixed formats so a restore on any machine verifies identically.
CREATE FUNCTION meter_point_canonical(p meter_points) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT concat_ws('|',
    p.nozzle_id::text, p.seq::text, p.epoch::text, p.wrap_count::text,
    p.reading::text, p.cumulative::text, p.point_type, p.business_date::text,
    COALESCE(p.shift_id::text, ''),
    to_char(p.effective_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    to_char(p.taken_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    p.entered_by::text, COALESCE(p.supersedes_id::text, ''), COALESCE(p.photo_id::text, ''),
    p.idempotency_key, COALESCE(encode(p.prev_hash, 'hex'), 'GENESIS'))
$$;

CREATE FUNCTION trg_meter_point_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  last meter_points%ROWTYPE;
  ep meter_epochs%ROWTYPE;
BEGIN
  -- Serialise per nozzle (the service also locks; this makes direct inserts safe too).
  PERFORM 1 FROM nozzles WHERE id = NEW.nozzle_id FOR UPDATE;
  SELECT * INTO ep FROM meter_epochs WHERE nozzle_id = NEW.nozzle_id AND epoch = NEW.epoch;
  IF NOT FOUND THEN RAISE EXCEPTION 'No meter epoch % for this nozzle', NEW.epoch; END IF;

  -- H2 at the database level: digits must fit the physical display of this epoch's meter.
  IF NEW.reading >= ep.modulus OR NEW.reading <> round(NEW.reading, ep.decimals) THEN
    RAISE EXCEPTION 'METER_RANGE: reading % does not fit a %+% digit meter', NEW.reading, ep.int_digits, ep.decimals
      USING ERRCODE = 'P0010';
  END IF;
  NEW.cumulative := NEW.reading + NEW.wrap_count * ep.modulus;

  SELECT * INTO last FROM meter_points WHERE nozzle_id = NEW.nozzle_id ORDER BY seq DESC LIMIT 1;
  NEW.seq := COALESCE(last.seq, 0) + 1;
  NEW.prev_hash := last.row_hash;

  IF NEW.point_type = 'BASELINE' THEN
    IF FOUND THEN RAISE EXCEPTION 'BASELINE must be the first point of a nozzle'; END IF;
  ELSIF NEW.supersedes_id IS NULL AND NEW.point_type IN ('DAY_END','SHIFT_END','PRICE_CHANGE','ROLLOVER','GAP_BOUNDARY') THEN
    -- Non-correction points must not go backwards in the same epoch (H3, enforced by the DB too).
    IF EXISTS (SELECT 1 FROM v_meter_points_live l
                WHERE l.nozzle_id = NEW.nozzle_id AND l.epoch = NEW.epoch AND l.cumulative > NEW.cumulative) THEN
      RAISE EXCEPTION 'METER_DECREASE: reading is lower than the previous reading' USING ERRCODE = 'P0011';
    END IF;
    IF NEW.effective_at < (SELECT max(effective_at) FROM v_meter_points_live WHERE nozzle_id = NEW.nozzle_id) THEN
      RAISE EXCEPTION 'METER_TIME: a new reading cannot be earlier than the latest reading';
    END IF;
  END IF;

  NEW.row_hash := digest(meter_point_canonical(NEW), 'sha256');
  RETURN NEW;
END $$;

-- Live points: not superseded by a correction and not rejected (rejections arrive with the review queue).
CREATE VIEW v_meter_points_live AS
SELECT p.* FROM meter_points p
WHERE NOT EXISTS (SELECT 1 FROM meter_points c WHERE c.supersedes_id = p.id);

CREATE TRIGGER meter_point_chain BEFORE INSERT ON meter_points FOR EACH ROW EXECUTE FUNCTION trg_meter_point_chain();
SELECT make_fact_table('meter_points');

-- Hash-chain verification (nightly job and owner panel). Returns one row per broken link.
CREATE FUNCTION verify_meter_chains() RETURNS TABLE (nozzle_id UUID, seq BIGINT, problem TEXT)
LANGUAGE sql STABLE AS $$
  WITH ordered AS (
    SELECT p AS r,
           lag(p.row_hash) OVER (PARTITION BY p.nozzle_id ORDER BY p.seq) AS expected_prev,
           lag(p.seq) OVER (PARTITION BY p.nozzle_id ORDER BY p.seq) AS prev_seq
    FROM meter_points p
  ),
  checked AS (
    SELECT (o.r).nozzle_id AS nozzle_id, (o.r).seq AS seq, o.prev_seq,
           (o.r).prev_hash IS DISTINCT FROM o.expected_prev AS bad_link,
           (o.r).row_hash <> digest(meter_point_canonical(o.r), 'sha256') AS bad_content
    FROM ordered o
  )
  SELECT c.nozzle_id, c.seq, CASE
           WHEN c.bad_content THEN 'row content changed'
           WHEN c.bad_link THEN 'prev_hash does not match previous row'
           ELSE 'sequence gap' END
  FROM checked c
  WHERE c.bad_link OR c.bad_content
     OR (c.prev_seq IS NOT NULL AND c.seq <> c.prev_seq + 1)
     OR (c.prev_seq IS NULL AND c.seq <> 1)
$$;

-- Chain heads (one per nozzle) for backup manifests and the printed integrity code.
CREATE VIEW v_meter_chain_heads AS
SELECT DISTINCT ON (nozzle_id) nozzle_id, seq, encode(row_hash, 'hex') AS head
FROM meter_points ORDER BY nozzle_id, seq DESC;

-- ---------------------------------------------------------------------------
-- Testing fuel (optional button; owner: "can be done anytime"). Voids are separate rows (D5).
-- ---------------------------------------------------------------------------
CREATE TABLE nozzle_tests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nozzle_id           UUID NOT NULL REFERENCES nozzles(id),
  tested_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  litres              NUMERIC(8,3) NOT NULL CHECK (litres > 0 AND litres <= 50),
  returned_to_tank    BOOLEAN NOT NULL,
  not_returned_reason TEXT,
  entered_by          UUID NOT NULL REFERENCES users(id),
  idempotency_key     TEXT NOT NULL UNIQUE,
  CHECK (returned_to_tank OR length(trim(COALESCE(not_returned_reason, ''))) > 0)
);
SELECT make_fact_table('nozzle_tests');

CREATE TABLE nozzle_test_voids (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id    UUID NOT NULL UNIQUE REFERENCES nozzle_tests(id),
  reason     TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
  voided_by  UUID NOT NULL REFERENCES users(id),
  at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
SELECT make_fact_table('nozzle_test_voids');

-- ---------------------------------------------------------------------------
-- Blocked attempts and flags (evidence even when nothing was saved).
-- ---------------------------------------------------------------------------
CREATE TABLE meter_entry_attempts (
  id               BIGSERIAL PRIMARY KEY,
  nozzle_id        UUID NOT NULL REFERENCES nozzles(id),
  user_id          UUID NOT NULL REFERENCES users(id),
  attempted_value  TEXT NOT NULL,
  expected_min     NUMERIC(12,2),
  rule_code        TEXT NOT NULL,
  at               TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ip               TEXT
);
SELECT make_fact_table('meter_entry_attempts');
GRANT USAGE ON SEQUENCE meter_entry_attempts_id_seq TO pump_app;

CREATE TABLE meter_flags (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nozzle_id      UUID NOT NULL REFERENCES nozzles(id),
  point_id       UUID REFERENCES meter_points(id),
  business_date  DATE NOT NULL,
  code           TEXT NOT NULL,
  severity       TEXT NOT NULL CHECK (severity IN ('REVIEW','INFO')),
  detail         JSONB NOT NULL DEFAULT '{}'::jsonb,
  raised_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
SELECT make_fact_table('meter_flags');

CREATE TABLE meter_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id       UUID NOT NULL UNIQUE REFERENCES meter_flags(id),
  decision      TEXT NOT NULL CHECK (decision IN ('ACCEPT_AS_IS','MARK_NO_SALE')),
  reason        TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
  reviewer_id   UUID NOT NULL REFERENCES users(id),
  self_review   BOOLEAN NOT NULL DEFAULT false,
  reviewed_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
SELECT make_fact_table('meter_reviews');

CREATE FUNCTION trg_meter_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_entered UUID; v_role TEXT;
BEGIN
  SELECT p.entered_by INTO v_entered FROM meter_flags f LEFT JOIN meter_points p ON p.id = f.point_id WHERE f.id = NEW.flag_id;
  SELECT role_code INTO v_role FROM users WHERE id = NEW.reviewer_id;
  IF v_role IS DISTINCT FROM 'OWNER' THEN
    RAISE EXCEPTION 'Only the owner can review flagged readings';
  END IF;
  NEW.self_review := (v_entered = NEW.reviewer_id);
  RETURN NEW;
END $$;
CREATE TRIGGER meter_review_guard BEFORE INSERT ON meter_reviews FOR EACH ROW EXECUTE FUNCTION trg_meter_review_guard();

CREATE VIEW v_open_meter_flags AS
SELECT f.* FROM meter_flags f
WHERE f.severity = 'REVIEW' AND NOT EXISTS (SELECT 1 FROM meter_reviews r WHERE r.flag_id = f.id);

-- ---------------------------------------------------------------------------
-- Segments (derived, never typed). Price = that business day's rate (8 AM rate change
-- coincides with the 8 AM day cut-over; see FINAL_ARCHITECTURE section 7).
-- ---------------------------------------------------------------------------
CREATE VIEW v_meter_segments AS
WITH live AS (
  SELECT l.*,
         lag(l.id)           OVER w AS start_id,
         lag(l.reading)      OVER w AS start_reading,
         lag(l.cumulative)   OVER w AS start_cumulative,
         lag(l.epoch)        OVER w AS start_epoch,
         lag(l.effective_at) OVER w AS start_at,
         lag(l.business_date) OVER w AS start_business_date
  FROM v_meter_points_live l
  WINDOW w AS (PARTITION BY l.nozzle_id ORDER BY l.effective_at, l.seq)
),
seg AS (
  SELECT l.nozzle_id, l.start_id, l.id AS end_id, l.start_reading, l.reading AS end_reading,
         l.start_at, l.effective_at AS end_at, l.business_date, l.point_type AS end_type, l.entered_by,
         CASE WHEN l.epoch = l.start_epoch THEN l.cumulative - l.start_cumulative ELSE 0 END AS throughput,
         CASE WHEN l.epoch <> l.start_epoch THEN 'EVENT_BRIDGE'
              WHEN l.business_date - l.start_business_date > 1 AND l.start_business_date IS NOT NULL
                   AND (SELECT point_type FROM meter_points WHERE id = l.start_id) <> 'BASELINE' THEN 'MULTI_DAY'
              ELSE 'NORMAL' END AS kind
  FROM live l WHERE l.start_id IS NOT NULL
),
tests AS (
  SELECT s.end_id,
         COALESCE(SUM(t.litres) FILTER (WHERE t.returned_to_tank), 0)::NUMERIC(12,3) AS tests_returned,
         COALESCE(SUM(t.litres) FILTER (WHERE NOT t.returned_to_tank), 0)::NUMERIC(12,3) AS tests_not_returned
  FROM seg s
  LEFT JOIN nozzle_tests t ON t.nozzle_id = s.nozzle_id AND t.tested_at > s.start_at AND t.tested_at <= s.end_at
       AND NOT EXISTS (SELECT 1 FROM nozzle_test_voids v WHERE v.test_id = t.id)
  GROUP BY s.end_id
)
SELECT s.*, st.site_id, n.station_id, n.fuel_type_id, n.label AS nozzle_label,
       t.tests_returned, t.tests_not_returned,
       (s.throughput - t.tests_returned - t.tests_not_returned)::NUMERIC(12,3) AS customer_litres,
       (s.throughput - t.tests_returned)::NUMERIC(12,3) AS net_tank_depletion,
       r.rate,
       CASE WHEN r.rate IS NULL THEN NULL
            ELSE round((s.throughput - t.tests_returned - t.tests_not_returned) * r.rate, 2) END AS sales_value,
       NOT EXISTS (SELECT 1 FROM v_open_meter_flags f WHERE f.point_id IN (s.start_id, s.end_id))
         AND s.kind <> 'MULTI_DAY' AS confirmed
FROM seg s
JOIN tests t ON t.end_id = s.end_id
JOIN nozzles n ON n.id = s.nozzle_id
JOIN stations st ON st.id = n.station_id
LEFT JOIN v_daily_rates r ON r.site_id = st.site_id AND r.fuel_type_id = n.fuel_type_id AND r.business_date = s.business_date;

GRANT SELECT ON v_daily_rates, v_meter_points_live, v_meter_chain_heads, v_open_meter_flags, v_meter_segments TO pump_app, pump_backup;
