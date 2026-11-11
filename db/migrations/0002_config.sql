-- 0002_config: site, stations, fuel, tanks, nozzles, shifts, payment modes, settings.
-- Configuration (C) tables: editable by the owner through the app, always audited, never deleted.

CREATE TABLE sites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  address      TEXT,
  timezone     TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  day_cutover  TIME NOT NULL DEFAULT '08:00',   -- business day boundary (owner to confirm, OPEN_QUESTIONS Q3b)
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT make_config_table('sites');

CREATE TABLE fuel_types (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code      TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z_]+$'),
  name_en   TEXT NOT NULL,
  name_hi   TEXT NOT NULL,
  short     TEXT NOT NULL,          -- register abbreviation: MS / HSD
  colour    TEXT NOT NULL DEFAULT '#888888',
  active    BOOLEAN NOT NULL DEFAULT true
);
SELECT make_config_table('fuel_types');

CREATE TABLE stations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID NOT NULL REFERENCES sites(id),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true
);
SELECT make_config_table('stations');

CREATE TABLE tanks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id),
  fuel_type_id     UUID NOT NULL REFERENCES fuel_types(id),
  name             TEXT NOT NULL,
  capacity_litres  NUMERIC(12,3) CHECK (capacity_litres > 0),
  active           BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (site_id, name)
);
SELECT make_config_table('tanks');

CREATE TABLE nozzles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id      UUID NOT NULL REFERENCES stations(id),
  fuel_type_id    UUID NOT NULL REFERENCES fuel_types(id),
  tank_id         UUID NULL REFERENCES tanks(id),   -- unknown until owner answers Q1b
  number          SMALLINT NOT NULL CHECK (number > 0),
  label           TEXT NOT NULL,                    -- e.g. "HSD A1"
  max_flow_lpm    NUMERIC(6,2) NOT NULL DEFAULT 50 CHECK (max_flow_lpm > 0),
  sort_order      SMALLINT NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (station_id, number)
);
SELECT make_config_table('nozzles');

CREATE FUNCTION trg_nozzle_tank_fuel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tank_id IS NOT NULL AND
     (SELECT fuel_type_id FROM tanks WHERE id = NEW.tank_id) <> NEW.fuel_type_id THEN
    RAISE EXCEPTION 'Nozzle fuel type must match its tank fuel type';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER nozzle_tank_fuel BEFORE INSERT OR UPDATE ON nozzles
  FOR EACH ROW EXECUTE FUNCTION trg_nozzle_tank_fuel();

CREATE TABLE shifts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID NOT NULL REFERENCES sites(id),
  name        TEXT NOT NULL,
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true    -- owner answer: shifts not used (single daily reading)
);
SELECT make_config_table('shifts');

CREATE TABLE payment_modes (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     TEXT NOT NULL UNIQUE,
  name_en                  TEXT NOT NULL,
  name_hi                  TEXT NOT NULL,
  kind                     TEXT NOT NULL CHECK (kind IN ('CASH','UPI','CARD','BANK','CREDIT','OTHER')),
  allowed_on_receipt       BOOLEAN NOT NULL,
  allowed_on_payment       BOOLEAN NOT NULL,
  allowed_on_sales_split   BOOLEAN NOT NULL,
  sort_order               SMALLINT NOT NULL DEFAULT 0,
  active                   BOOLEAN NOT NULL DEFAULT true,
  -- Contradiction C12: "customer credit" is only a way a SALE is settled, never a money movement.
  CHECK (kind <> 'CREDIT' OR (NOT allowed_on_receipt AND NOT allowed_on_payment))
);
SELECT make_config_table('payment_modes');

INSERT INTO payment_modes (code, name_en, name_hi, kind, allowed_on_receipt, allowed_on_payment, allowed_on_sales_split, sort_order) VALUES
  ('CASH',            'Cash',                 'नकद',          'CASH',   true,  true,  true,  1),
  ('UPI',             'UPI',                  'यूपीआई',        'UPI',    true,  true,  true,  2),
  ('PAYTM',           'Paytm',                'पेटीएम',        'UPI',    true,  true,  true,  3),
  ('DEBIT_CARD',      'Debit card',           'डेबिट कार्ड',    'CARD',   true,  false, true,  4),
  ('CREDIT_CARD',     'Credit card',          'क्रेडिट कार्ड',   'CARD',   true,  false, true,  5),
  ('BANK_TRANSFER',   'Bank transfer',        'बैंक ट्रांसफर',   'BANK',   true,  true,  true,  6),
  ('CUSTOMER_CREDIT', 'Customer credit (Udhari)', 'उधारी',       'CREDIT', false, false, true,  7),
  ('OTHER',           'Other',                'अन्य',          'OTHER',  true,  true,  true,  8);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT make_config_table('settings');

INSERT INTO settings (key, value, description) VALUES
  ('cash_rounding_tolerance', '"10.00"', 'Cash differences within ± this amount are labelled rounding (still recorded)'),
  ('flag_high_volume_multiple', '"3"',   'Flag readings above N x 14-day median litres'),
  ('flag_low_volume_fraction', '"0.25"', 'Flag readings below this fraction of the 14-day median'),
  ('test_max_litres_per_pour', '"20.000"', 'A single test pour above this is blocked at entry'),
  ('late_entry_hours', '"6"', 'Entries this many hours after the business day ended are flagged late'),
  ('employee_session_hours', '"12"', 'Staff session idle expiry'),
  ('owner_session_days', '"7"', 'Owner device session expiry');
