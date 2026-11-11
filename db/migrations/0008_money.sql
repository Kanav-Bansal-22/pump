-- 0008_money: parties (customers, suppliers, lenders, staff), the register's daily money entries,
-- end-of-day cash count, day snapshots, and the locked-day guard for meter readings.

-- ---------------------------------------------------------------------------
-- Extra money accounts. 1150: the day's counted cash handed to the owner at closing (the register
-- starts every day without opening cash). 1200: the business bank account (UPI/bank payments out).
-- ---------------------------------------------------------------------------
INSERT INTO accounts (code, name_en, name_hi, type, subtype, party_kind, allowed_sources, is_system, sort_order) VALUES
 ('1150','Cash handed to owner / safe','मालिक को नकद / तिजोरी','ASSET','CASH',NULL, money_account_sources(), true, 15),
 ('1200','Bank account','बैंक खाता','ASSET','BANK',NULL, money_account_sources(), true, 20);

-- ---------------------------------------------------------------------------
-- Parties: everyone money is owed to or by. Never deleted; deactivated instead.
-- ---------------------------------------------------------------------------
CREATE TABLE parties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL CHECK (kind IN ('CUSTOMER','SUPPLIER','LENDER','EMPLOYEE')),
  name        TEXT NOT NULL CHECK (length(trim(name)) >= 2),
  phone       TEXT CHECK (phone IS NULL OR phone ~ '^[0-9]{10}$'),
  address     TEXT,
  remarks     TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX parties_phone_unique ON parties (kind, phone) WHERE phone IS NOT NULL;
CREATE INDEX parties_name ON parties (kind, lower(name));
SELECT make_config_table('parties');

-- journal party ids must be real parties of the right kind
CREATE FUNCTION trg_journal_line_party() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.party_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM parties WHERE id = NEW.party_id AND kind = NEW.party_kind) THEN
    RAISE EXCEPTION 'Unknown % party', NEW.party_kind;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_line_party BEFORE INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION trg_journal_line_party();

-- ---------------------------------------------------------------------------
-- Money entries: one row per line the staff would have written in the Rokad.
-- The journal entry is created in the same transaction by the posting service.
-- ---------------------------------------------------------------------------
CREATE TABLE money_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_no          BIGSERIAL UNIQUE,
  site_id           UUID NOT NULL REFERENCES sites(id),
  business_date     DATE NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN (
                      'CREDIT_SALE','CUSTOMER_REPAYMENT','LUBE_SALE','OTHER_INCOME','LOAN_RECEIVED','OWNER_CAPITAL',
                      'EXPENSE','SUPPLIER_PAYMENT','BANK_DEPOSIT','SALARY','STAFF_ADVANCE','OWNER_DRAWING','LOAN_REPAYMENT')),
  party_id          UUID REFERENCES parties(id),
  expense_account_id UUID REFERENCES accounts(id),
  mode_code         TEXT NOT NULL REFERENCES payment_modes(code),
  amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0 AND amount < 100000000),
  vehicle_no        TEXT,
  slip_no           TEXT,
  fuel_type_id      UUID REFERENCES fuel_types(id),
  litres            NUMERIC(12,3) CHECK (litres IS NULL OR litres > 0),
  description       TEXT,
  entered_by        UUID NOT NULL REFERENCES users(id),
  entered_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  journal_entry_id  UUID NOT NULL UNIQUE REFERENCES journal_entries(id),
  idempotency_key   TEXT NOT NULL UNIQUE,
  CHECK ((kind = 'CREDIT_SALE') = (mode_code = 'CUSTOMER_CREDIT')),
  CHECK (kind NOT IN ('CREDIT_SALE','CUSTOMER_REPAYMENT') OR party_id IS NOT NULL),
  CHECK (kind <> 'EXPENSE' OR expense_account_id IS NOT NULL)
);
CREATE INDEX money_entries_day ON money_entries (site_id, business_date);
CREATE INDEX money_entries_party ON money_entries (party_id);
SELECT make_fact_table('money_entries');
GRANT USAGE ON SEQUENCE money_entries_entry_no_seq TO pump_app;

-- Cancelling an entry = an exact reversal journal + this row (the original stays visible).
CREATE TABLE money_entry_reversals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  money_entry_id    UUID NOT NULL UNIQUE REFERENCES money_entries(id),
  reason            TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
  reversed_by       UUID NOT NULL REFERENCES users(id),
  journal_entry_id  UUID NOT NULL UNIQUE REFERENCES journal_entries(id),
  at                TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
SELECT make_fact_table('money_entry_reversals');

CREATE VIEW v_money_entries_live AS
SELECT m.* FROM money_entries m WHERE NOT EXISTS (SELECT 1 FROM money_entry_reversals r WHERE r.money_entry_id = m.id);

-- ---------------------------------------------------------------------------
-- End-of-day cash count. A recount before the lock adds a new row; the latest counts.
-- ---------------------------------------------------------------------------
CREATE TABLE cash_counts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        UUID NOT NULL REFERENCES sites(id),
  business_date  DATE NOT NULL,
  counted        NUMERIC(14,2) NOT NULL CHECK (counted >= 0),
  expected_at_count NUMERIC(14,2) NOT NULL,
  counted_by     UUID NOT NULL REFERENCES users(id),
  at             TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  idempotency_key TEXT NOT NULL UNIQUE
);
SELECT make_fact_table('cash_counts');

CREATE FUNCTION trg_cash_count_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF lock_business_day_for_posting(NEW.site_id, NEW.business_date) <> 'OPEN' THEN
    RAISE EXCEPTION 'DAY_LOCKED: the day is already submitted or locked; ask the owner' USING ERRCODE = 'P0002';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cash_count_guard BEFORE INSERT ON cash_counts FOR EACH ROW EXECUTE FUNCTION trg_cash_count_guard();

-- Snapshot of the day's figures at the moment of locking (never changes afterwards).
CREATE TABLE day_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        UUID NOT NULL REFERENCES sites(id),
  business_date  DATE NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('LOCK','POST_LOCK_CORRECTION')),
  figures        JSONB NOT NULL,
  integrity_code TEXT NOT NULL,
  created_by     UUID NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX day_snapshots_one_lock ON day_snapshots (site_id, business_date) WHERE kind = 'LOCK';
SELECT make_fact_table('day_snapshots');

-- ---------------------------------------------------------------------------
-- Meter readings cannot be added to a submitted / locked day either (corrections come later).
-- ---------------------------------------------------------------------------
CREATE FUNCTION trg_meter_point_day_open() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site UUID;
BEGIN
  SELECT st.site_id INTO v_site FROM nozzles n JOIN stations st ON st.id = n.station_id WHERE n.id = NEW.nozzle_id;
  IF NEW.point_type <> 'BASELINE' AND NEW.supersedes_id IS NULL
     AND lock_business_day_for_posting(v_site, NEW.business_date) = 'LOCKED' THEN
    RAISE EXCEPTION 'DAY_LOCKED: readings for % are locked', NEW.business_date USING ERRCODE = 'P0002';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meter_point_day_open BEFORE INSERT ON meter_points FOR EACH ROW EXECUTE FUNCTION trg_meter_point_day_open();

INSERT INTO settings (key, value, description) VALUES
  ('cash_handover_at_close', 'true', 'At day lock the counted cash is handed to the owner (register has no opening cash)')
ON CONFLICT (key) DO NOTHING;

GRANT SELECT ON v_money_entries_live TO pump_app, pump_backup;
