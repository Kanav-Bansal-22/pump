-- 0003_auth: roles, permissions, users, sessions, PIN devices, login attempts, idempotency, employees.

CREATE TABLE roles (
  code  TEXT PRIMARY KEY CHECK (code IN ('OWNER','MANAGER','STAFF')),
  name  TEXT NOT NULL
);
SELECT make_config_table('roles');
INSERT INTO roles VALUES ('OWNER','Owner'), ('MANAGER','Manager (not used yet)'), ('STAFF','Staff');

CREATE TABLE permissions (
  code         TEXT PRIMARY KEY,
  description  TEXT NOT NULL
);
SELECT make_config_table('permissions');
INSERT INTO permissions VALUES
  ('meter.enter',          'Enter nozzle readings'),
  ('tests.record',         'Record testing fuel'),
  ('meter.event.request',  'Request meter reset / rollover / replacement'),
  ('meter.event.approve',  'Approve meter events (never own request)'),
  ('meter.review',         'Review flagged readings'),
  ('meter.correct',        'Approve reading corrections'),
  ('price.set',            'Set daily fuel rates'),
  ('receipt.create',       'Record receipts / udhari received'),
  ('payment.create',       'Record payments'),
  ('credit.create',        'Record udhari given'),
  ('customer.manage',      'Create / edit customers'),
  ('customer.view_balance','See customer outstanding balances'),
  ('cash.count',           'Enter end-of-day cash count'),
  ('closing.lock',         'Lock a business day'),
  ('closing.override',     'Override closing guards with a reason'),
  ('report.financial',     'View financial reports and dashboard'),
  ('import.run',           'Run opening-balance imports'),
  ('users.manage',         'Manage users and devices'),
  ('settings.manage',      'Change configuration and settings'),
  ('backup.manage',        'View backups, download backup copies');

CREATE TABLE role_permissions (
  role_code        TEXT NOT NULL REFERENCES roles(code),
  permission_code  TEXT NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (role_code, permission_code)
);
SELECT make_config_table('role_permissions');
-- role_permissions rows may need to be removed when the owner changes staff rights:
-- we keep the no-delete rule and use an "active" style override table instead.
INSERT INTO role_permissions SELECT 'OWNER', code FROM permissions;
INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('STAFF','meter.enter'), ('STAFF','tests.record'), ('STAFF','meter.event.request'),
  ('STAFF','receipt.create'), ('STAFF','payment.create'), ('STAFF','credit.create'),
  ('STAFF','cash.count');

CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  username              TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.]{3,32}$'),
  password_hash         TEXT NOT NULL,
  role_code             TEXT NOT NULL REFERENCES roles(code),
  active                BOOLEAN NOT NULL DEFAULT true,
  must_change_password  BOOLEAN NOT NULL DEFAULT true,
  failed_logins         INT NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT make_config_table('users');

-- Per-user permission overrides (grant or deny), latest row wins.
CREATE TABLE user_permission_overrides (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id),
  permission_code  TEXT NOT NULL REFERENCES permissions(code),
  granted          BOOLEAN NOT NULL,
  set_by           UUID REFERENCES users(id),
  set_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
SELECT make_fact_table('user_permission_overrides');

CREATE VIEW v_user_permissions AS
SELECT u.id AS user_id, p.code AS permission_code
FROM users u CROSS JOIN permissions p
WHERE u.active AND COALESCE(
  (SELECT o.granted FROM user_permission_overrides o
    WHERE o.user_id = u.id AND o.permission_code = p.code
    ORDER BY o.set_at DESC LIMIT 1),
  EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_code = u.role_code AND rp.permission_code = p.code));
GRANT SELECT ON v_user_permissions TO pump_app, pump_backup;

CREATE TABLE user_stations (
  user_id     UUID NOT NULL REFERENCES users(id),
  station_id  UUID NOT NULL REFERENCES stations(id),
  active      BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, station_id)
);
SELECT make_config_table('user_stations');

CREATE TABLE sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  token_hash   BYTEA NOT NULL UNIQUE,
  device_id    TEXT,
  ip           TEXT,
  user_agent   TEXT,
  via_pin      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);
-- Sessions are operational: the app updates last_seen_at / revoked_at; no deletes.
SELECT make_config_table('sessions');
CREATE INDEX sessions_user ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE pin_devices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id),
  device_token_hash  BYTEA NOT NULL UNIQUE,
  pin_hash           TEXT NOT NULL,
  failed_pins        INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  revoked_at         TIMESTAMPTZ
);
SELECT make_config_table('pin_devices');

CREATE TABLE login_attempts (
  id        BIGSERIAL PRIMARY KEY,
  username  TEXT NOT NULL,
  ip        TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  success   BOOLEAN NOT NULL,
  method    TEXT NOT NULL CHECK (method IN ('PASSWORD','PIN')),
  reason    TEXT
);
SELECT make_fact_table('login_attempts');
GRANT USAGE ON SEQUENCE login_attempts_id_seq TO pump_app;

-- Idempotency (decision D9): same key + same body -> stored response; same key + different body -> rejected.
CREATE TABLE idempotency_keys (
  key           TEXT PRIMARY KEY CHECK (length(key) BETWEEN 16 AND 100),
  user_id       UUID NOT NULL REFERENCES users(id),
  endpoint      TEXT NOT NULL,
  request_hash  BYTEA NOT NULL,
  status_code   INT NOT NULL,
  response      JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
SELECT make_fact_table('idempotency_keys');

CREATE TABLE employees (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID UNIQUE REFERENCES users(id),
  name                TEXT NOT NULL,
  phone               TEXT,
  monthly_salary      NUMERIC(14,2) CHECK (monthly_salary >= 0),
  active              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT make_config_table('employees');
