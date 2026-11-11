-- 0004_days_ops: business days (site level: one cash count per day), attachments, ops logs, future hooks.

CREATE TABLE business_days (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id),
  business_date    DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SUBMITTED','LOCKED')),
  submitted_by     UUID REFERENCES users(id),
  submitted_at     TIMESTAMPTZ,
  locked_by        UUID REFERENCES users(id),
  locked_at        TIMESTAMPTZ,
  override_reason  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (site_id, business_date)
);
SELECT make_workflow_table('business_days');

-- State machine (decision D5): OPEN -> SUBMITTED -> LOCKED, SUBMITTED -> OPEN (sent back).
-- Identity columns never change; LOCKED is final.
CREATE FUNCTION trg_business_day_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.site_id <> OLD.site_id OR NEW.business_date <> OLD.business_date
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'business_days identity columns cannot change';
  END IF;
  IF NOT ((OLD.status = 'OPEN' AND NEW.status = 'SUBMITTED')
       OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('OPEN','LOCKED'))) THEN
    RAISE EXCEPTION 'business day transition % -> % not allowed', OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'LOCKED' AND (NEW.locked_by IS NULL OR NEW.locked_at IS NULL) THEN
    RAISE EXCEPTION 'locking requires locked_by and locked_at';
  END IF;
  IF NEW.status = 'SUBMITTED' AND (NEW.submitted_by IS NULL OR NEW.submitted_at IS NULL) THEN
    RAISE EXCEPTION 'submitting requires submitted_by and submitted_at';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER business_day_transition BEFORE UPDATE ON business_days
  FOR EACH ROW EXECUTE FUNCTION trg_business_day_transition();

-- Ensures the day row exists and takes a SHARE lock on it, so a concurrent LOCK
-- (which takes FOR UPDATE) waits for in-flight postings (decision D8).
CREATE FUNCTION lock_business_day_for_posting(p_site UUID, p_date DATE) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE v_status TEXT;
BEGIN
  INSERT INTO business_days (site_id, business_date) VALUES (p_site, p_date)
    ON CONFLICT (site_id, business_date) DO NOTHING;
  SELECT status INTO v_status FROM business_days
    WHERE site_id = p_site AND business_date = p_date FOR SHARE;
  RETURN v_status;
END $$;

CREATE TABLE attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path         TEXT NOT NULL UNIQUE,
  mime         TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','application/pdf',
                 'text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  sha256       BYTEA NOT NULL,
  size_bytes   INT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  uploaded_by  UUID NOT NULL REFERENCES users(id),
  at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
SELECT make_fact_table('attachments');

CREATE TABLE backup_log (
  id                BIGSERIAL PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('HOURLY','NIGHTLY','PREMIGRATION','MANUAL')),
  started_at        TIMESTAMPTZ NOT NULL,
  finished_at       TIMESTAMPTZ NOT NULL,
  path              TEXT,
  size_bytes        BIGINT,
  sha256            TEXT,
  ok                BOOLEAN NOT NULL,
  manifest_written  BOOLEAN NOT NULL DEFAULT false,
  error             TEXT
);
SELECT make_fact_table('backup_log');
GRANT USAGE ON SEQUENCE backup_log_id_seq TO pump_app;

CREATE TABLE backup_downloads (     -- owner downloaded a backup copy to phone (no-USB setup)
  id           BIGSERIAL PRIMARY KEY,
  backup_id    BIGINT NOT NULL REFERENCES backup_log(id),
  user_id      UUID NOT NULL REFERENCES users(id),
  at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
SELECT make_fact_table('backup_downloads');
GRANT USAGE ON SEQUENCE backup_downloads_id_seq TO pump_app;

CREATE TABLE app_errors (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  level       TEXT NOT NULL,
  message     TEXT NOT NULL,
  detail      TEXT,
  user_id     UUID,
  request_id  TEXT
);
SELECT make_fact_table('app_errors');
GRANT USAGE ON SEQUENCE app_errors_id_seq TO pump_app;

-- FUTURE HOOKS ONLY (Part 16). No code uses these in v1. Never store passwords/OTPs here.
CREATE TABLE payment_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source            TEXT NOT NULL,
  external_ref      TEXT NOT NULL UNIQUE,
  raw               JSONB NOT NULL,
  parsed            JSONB,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  matched_entry_id  UUID
);
SELECT make_fact_table('payment_events');

CREATE TABLE integrations (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind     TEXT NOT NULL UNIQUE,
  enabled  BOOLEAN NOT NULL DEFAULT false,
  config   JSONB NOT NULL DEFAULT '{}'::jsonb
);
SELECT make_config_table('integrations');
