-- 0001_base: extensions, request context, immutability / audit / state-machine helpers.
-- Runs as pump_owner (the migrator does SET ROLE pump_owner). All objects are owned by pump_owner.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Request context: the app sets these with SET LOCAL inside every transaction.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;
CREATE FUNCTION app_request_id() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.request_id', true), '')
$$;
CREATE FUNCTION app_ip() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.ip', true), '')
$$;

-- ---------------------------------------------------------------------------
-- Audit log (itself immutable).
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  user_id     UUID,
  action      TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  record_id   TEXT,
  old_value   JSONB,
  new_value   JSONB,
  request_id  TEXT,
  ip          TEXT,
  db_role     TEXT NOT NULL DEFAULT current_user
);
CREATE INDEX audit_log_table_record ON audit_log (table_name, record_id);
CREATE INDEX audit_log_at ON audit_log (at);

CREATE FUNCTION trg_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value, request_id, ip)
  VALUES (app_user_id(), TG_OP, TG_TABLE_NAME,
          CASE WHEN TG_OP = 'DELETE' THEN (to_jsonb(OLD)->>'id') ELSE (to_jsonb(NEW)->>'id') END,
          CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END,
          app_request_id(), app_ip());
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Immutability: fact tables reject UPDATE / DELETE / TRUNCATE for every role,
-- including the table owner. Only a superuser disabling the trigger can bypass
-- this, which the hash chains / independent anchors are designed to detect.
-- ---------------------------------------------------------------------------
CREATE FUNCTION trg_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE: % on % is not allowed; use a correction entry', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END $$;

-- Helper used by later migrations: mark a table as an immutable fact table.
CREATE FUNCTION make_fact_table(tbl regclass) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON %s
                  FOR EACH ROW EXECUTE FUNCTION trg_immutable()', tbl);
  EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON %s
                  FOR EACH STATEMENT EXECUTE FUNCTION trg_immutable()', tbl);
  EXECUTE format('CREATE TRIGGER audit AFTER INSERT ON %s
                  FOR EACH ROW EXECUTE FUNCTION trg_audit()', tbl);
  EXECUTE format('REVOKE ALL ON %s FROM PUBLIC', tbl);
  EXECUTE format('GRANT SELECT, INSERT ON %s TO pump_app', tbl);
  EXECUTE format('GRANT SELECT ON %s TO pump_backup', tbl);
END $$;

-- Configuration tables: owner-editable through the app, every change audited, no DELETE.
CREATE FUNCTION make_config_table(tbl regclass) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON %s
                  FOR EACH ROW EXECUTE FUNCTION trg_immutable()', tbl);
  EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON %s
                  FOR EACH STATEMENT EXECUTE FUNCTION trg_immutable()', tbl);
  EXECUTE format('CREATE TRIGGER audit AFTER INSERT OR UPDATE ON %s
                  FOR EACH ROW EXECUTE FUNCTION trg_audit()', tbl);
  EXECUTE format('REVOKE ALL ON %s FROM PUBLIC', tbl);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %s TO pump_app', tbl);
  EXECUTE format('GRANT SELECT ON %s TO pump_backup', tbl);
END $$;

-- Workflow tables: rows may only change their status along allowed transitions.
-- Each workflow table supplies its own BEFORE UPDATE trigger enforcing transitions.
CREATE FUNCTION make_workflow_table(tbl regclass) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON %s
                  FOR EACH ROW EXECUTE FUNCTION trg_immutable()', tbl);
  EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON %s
                  FOR EACH STATEMENT EXECUTE FUNCTION trg_immutable()', tbl);
  EXECUTE format('CREATE TRIGGER audit AFTER INSERT OR UPDATE ON %s
                  FOR EACH ROW EXECUTE FUNCTION trg_audit()', tbl);
  EXECUTE format('REVOKE ALL ON %s FROM PUBLIC', tbl);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %s TO pump_app', tbl);
  EXECUTE format('GRANT SELECT ON %s TO pump_backup', tbl);
END $$;

SELECT make_fact_table('audit_log');
-- audit_log rows are written by SECURITY DEFINER trg_audit; the app may read but not insert directly.
REVOKE INSERT ON audit_log FROM pump_app;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO pump_owner;
-- An audit trigger on the audit table itself would recurse; drop it.
DROP TRIGGER audit ON audit_log;
