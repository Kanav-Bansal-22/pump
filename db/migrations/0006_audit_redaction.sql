-- 0006_audit_redaction: never copy secrets (password / PIN / token hashes) into audit_log.
-- Found during Phase 2: users.password_hash would otherwise be duplicated into audit_log on every
-- login-counter update, where the owner's audit viewer could expose it for offline cracking.

CREATE OR REPLACE FUNCTION audit_redact(j JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN j IS NULL THEN NULL ELSE
    (SELECT COALESCE(jsonb_object_agg(k,
       CASE WHEN k IN ('password_hash','pin_hash','token_hash','device_token_hash')
            THEN '"[redacted]"'::jsonb ELSE v END), '{}'::jsonb)
     FROM jsonb_each(j) AS e(k, v))
  END
$$;

CREATE OR REPLACE FUNCTION trg_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value, request_id, ip)
  VALUES (app_user_id(), TG_OP, TG_TABLE_NAME,
          CASE WHEN TG_OP = 'DELETE' THEN (to_jsonb(OLD)->>'id') ELSE (to_jsonb(NEW)->>'id') END,
          CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN audit_redact(to_jsonb(OLD)) END,
          CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN audit_redact(to_jsonb(NEW)) END,
          app_request_id(), app_ip());
  RETURN NULL;
END $$;

-- Sessions change last_seen_at often; audit only creation and revocation, not every heartbeat.
DROP TRIGGER audit ON sessions;
CREATE TRIGGER audit_insert AFTER INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION trg_audit();
CREATE TRIGGER audit_revoke AFTER UPDATE OF revoked_at ON sessions FOR EACH ROW
  WHEN (OLD.revoked_at IS DISTINCT FROM NEW.revoked_at) EXECUTE FUNCTION trg_audit();
