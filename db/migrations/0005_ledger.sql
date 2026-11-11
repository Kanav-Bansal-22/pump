-- 0005_ledger: chart of accounts, double-entry journal, posting-rule guard (decision D3).
-- The database itself refuses postings that would double count:
--   * a journal must balance (deferred check at COMMIT);
--   * an account accepts only the source types listed in accounts.allowed_sources;
--   * REVERSAL entries must exactly mirror their original;
--   * nothing can be posted into a LOCKED business day except an owner POST_LOCK_CORRECTION.

CREATE TABLE source_types (
  code         TEXT PRIMARY KEY,
  description  TEXT NOT NULL
);
SELECT make_config_table('source_types');
INSERT INTO source_types VALUES
  ('CREDIT_SALE',           'Udhari given: settlement of a fuel sale on credit'),
  ('CUSTOMER_REPAYMENT',    'Udhari received from a customer'),
  ('OTHER_RECEIPT',         'Lubricant sales and other income'),
  ('EXPENSE_PAYMENT',       'Expense paid'),
  ('SUPPLIER_BILL',         'Supplier bill recorded (we owe them)'),
  ('SUPPLIER_PAYMENT',      'Payment that settles a supplier balance'),
  ('INTERNAL_TRANSFER',     'Money moved between our own cash/bank accounts'),
  ('BANK_DEPOSIT',          'Cash deposited to bank'),
  ('BANK_WITHDRAWAL',       'Cash withdrawn from bank'),
  ('UPI_SETTLEMENT',        'UPI/Paytm money settled to bank'),
  ('CARD_SETTLEMENT',       'Card money settled to bank'),
  ('DAY_SALES_POST',        'Fuel revenue for the day from meter readings (the ONLY fuel revenue)'),
  ('SALES_SETTLEMENT',      'How the day''s fuel sales were settled: cash / UPI / card'),
  ('SALES_RECLASS',         'Unconfirmed fuel sales moved to confirmed after review'),
  ('CASH_COUNT_DIFFERENCE', 'Cash short / excess moved to suspense (never an expense)'),
  ('SUSPENSE_RESOLUTION',   'Owner decision on a cash difference'),
  ('SALARY_PAYMENT',        'Salary paid'),
  ('STAFF_ADVANCE',         'Advance given to staff'),
  ('LOAN_RECEIVED',         'Loan received by the business'),
  ('LOAN_REPAYMENT',        'Loan repaid by the business'),
  ('OWNER_CAPITAL',         'Money put in by the owner'),
  ('OWNER_DRAWING',         'Money taken out by the owner'),
  ('OPENING_BALANCE',       'Go-live opening balances (never revenue or expense)'),
  ('REVERSAL',              'Exact reversal of an earlier entry'),
  ('POST_LOCK_CORRECTION',  'Owner correction to a locked day');

CREATE TABLE accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT NOT NULL UNIQUE,
  name_en          TEXT NOT NULL,
  name_hi          TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
  subtype          TEXT NOT NULL,
  party_kind       TEXT CHECK (party_kind IN ('CUSTOMER','SUPPLIER','EMPLOYEE','LENDER')),
  allowed_sources  TEXT[] NOT NULL,
  is_system        BOOLEAN NOT NULL DEFAULT false,
  active           BOOLEAN NOT NULL DEFAULT true,
  sort_order       INT NOT NULL DEFAULT 0
);
SELECT make_config_table('accounts');

-- allowed_sources must reference real source types
CREATE FUNCTION trg_accounts_sources_valid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(NEW.allowed_sources) s WHERE s NOT IN (SELECT code FROM source_types)) THEN
    RAISE EXCEPTION 'accounts.allowed_sources contains an unknown source type';
  END IF;
  IF OLD IS NOT NULL AND OLD.is_system AND (NEW.code <> OLD.code OR NEW.type <> OLD.type
      OR NEW.allowed_sources <> OLD.allowed_sources OR NEW.party_kind IS DISTINCT FROM OLD.party_kind) THEN
    RAISE EXCEPTION 'system account % rules cannot be changed', OLD.code;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accounts_sources_valid BEFORE INSERT OR UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION trg_accounts_sources_valid();

-- Money-moving accounts (cash, bank) share one list.
CREATE FUNCTION money_account_sources() RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['CUSTOMER_REPAYMENT','OTHER_RECEIPT','EXPENSE_PAYMENT','SUPPLIER_PAYMENT',
               'INTERNAL_TRANSFER','BANK_DEPOSIT','BANK_WITHDRAWAL','SALES_SETTLEMENT',
               'CASH_COUNT_DIFFERENCE','SALARY_PAYMENT','STAFF_ADVANCE','LOAN_RECEIVED',
               'LOAN_REPAYMENT','OWNER_CAPITAL','OWNER_DRAWING','OPENING_BALANCE',
               'UPI_SETTLEMENT','CARD_SETTLEMENT']
$$;

INSERT INTO accounts (code, name_en, name_hi, type, subtype, party_kind, allowed_sources, is_system, sort_order) VALUES
 ('1100','Cash in hand','नकद रोकड़','ASSET','CASH',NULL, money_account_sources(), true, 10),
 ('1300','UPI / Paytm to be settled','यूपीआई बकाया','ASSET','CLEARING',NULL,
    ARRAY['CUSTOMER_REPAYMENT','OTHER_RECEIPT','SALES_SETTLEMENT','UPI_SETTLEMENT','OPENING_BALANCE'], true, 30),
 ('1310','Card to be settled','कार्ड बकाया','ASSET','CLEARING',NULL,
    ARRAY['CUSTOMER_REPAYMENT','OTHER_RECEIPT','SALES_SETTLEMENT','CARD_SETTLEMENT','OPENING_BALANCE'], true, 31),
 ('1400','Customer udhari (receivable)','ग्राहक उधारी','ASSET','RECEIVABLE','CUSTOMER',
    ARRAY['CREDIT_SALE','CUSTOMER_REPAYMENT','OPENING_BALANCE'], true, 40),
 ('1600','Cash short/excess (under investigation)','नकद कमी/अधिक (जाँच)','ASSET','SUSPENSE',NULL,
    ARRAY['CASH_COUNT_DIFFERENCE','SUSPENSE_RESOLUTION'], true, 60),
 ('1700','Staff advances','कर्मचारी अग्रिम','ASSET','RECEIVABLE','EMPLOYEE',
    ARRAY['STAFF_ADVANCE','SALARY_PAYMENT','SUSPENSE_RESOLUTION','OPENING_BALANCE'], true, 70),
 ('1900','Fuel sales control (must be zero after day lock)','ईंधन बिक्री नियंत्रण','ASSET','CLEARING',NULL,
    ARRAY['CREDIT_SALE','DAY_SALES_POST','SALES_SETTLEMENT'], true, 90),
 ('2100','Suppliers (we owe)','सप्लायर बकाया','LIABILITY','PAYABLE','SUPPLIER',
    ARRAY['SUPPLIER_BILL','SUPPLIER_PAYMENT','OPENING_BALANCE'], true, 110),
 ('2200','Loans taken','लिया गया ऋण','LIABILITY','PAYABLE','LENDER',
    ARRAY['LOAN_RECEIVED','LOAN_REPAYMENT','OPENING_BALANCE'], true, 120),
 ('3100','Opening balance equity','प्रारंभिक शेष','EQUITY','EQUITY_OPENING',NULL, ARRAY['OPENING_BALANCE'], true, 210),
 ('3200','Owner capital / drawings','मालिक पूंजी / निकासी','EQUITY','EQUITY_OWNER',NULL,
    ARRAY['OWNER_CAPITAL','OWNER_DRAWING','OPENING_BALANCE'], true, 220),
 ('4100','Fuel sales: Petrol (MS)','पेट्रोल बिक्री','INCOME','FUEL_REVENUE',NULL, ARRAY['DAY_SALES_POST','SALES_RECLASS'], true, 310),
 ('4110','Fuel sales: Diesel (HSD)','डीज़ल बिक्री','INCOME','FUEL_REVENUE',NULL, ARRAY['DAY_SALES_POST','SALES_RECLASS'], true, 311),
 ('4190','Fuel sales: unconfirmed','अपुष्ट ईंधन बिक्री','INCOME','FUEL_REVENUE_UNCONFIRMED',NULL, ARRAY['DAY_SALES_POST','SALES_RECLASS'], true, 319),
 ('4200','Lubricant & other product sales','लुब्रिकेंट बिक्री','INCOME','OTHER_REVENUE',NULL, ARRAY['OTHER_RECEIPT'], true, 320),
 ('4300','Other income','अन्य आय','INCOME','OTHER_INCOME',NULL, ARRAY['OTHER_RECEIPT','SUSPENSE_RESOLUTION'], true, 330),
 ('5100','Fuel purchases','ईंधन खरीद','EXPENSE','COGS',NULL, ARRAY['SUPPLIER_BILL'], true, 410),
 ('6100','Salaries & wages','वेतन','EXPENSE','OPEX',NULL, ARRAY['EXPENSE_PAYMENT','SALARY_PAYMENT','SUPPLIER_BILL'], true, 510),
 ('6200','Electricity','बिजली','EXPENSE','OPEX',NULL, ARRAY['EXPENSE_PAYMENT','SUPPLIER_BILL'], true, 520),
 ('6300','Repairs & maintenance','मरम्मत','EXPENSE','OPEX',NULL, ARRAY['EXPENSE_PAYMENT','SUPPLIER_BILL'], true, 530),
 ('6400','Tea, milk & refreshments','चाय/दूध','EXPENSE','OPEX',NULL, ARRAY['EXPENSE_PAYMENT','SUPPLIER_BILL'], true, 540),
 ('6500','Miscellaneous expenses','अन्य खर्च','EXPENSE','OPEX',NULL, ARRAY['EXPENSE_PAYMENT','SUPPLIER_BILL'], true, 550),
 ('6900','Bank / card charges','बैंक शुल्क','EXPENSE','OPEX',NULL, ARRAY['UPI_SETTLEMENT','CARD_SETTLEMENT','EXPENSE_PAYMENT'], true, 590),
 ('6960','Cash shortage written off','नकद कमी बट्टे खाते','EXPENSE','OPEX',NULL, ARRAY['SUSPENSE_RESOLUTION'], true, 596);

-- ---------------------------------------------------------------------------
-- Journal
-- ---------------------------------------------------------------------------
CREATE TABLE journal_entries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_no           BIGSERIAL UNIQUE,
  site_id            UUID NOT NULL REFERENCES sites(id),
  business_date      DATE NOT NULL,
  station_id         UUID REFERENCES stations(id),
  source_type        TEXT NOT NULL REFERENCES source_types(code),
  source_id          UUID,                         -- the source document row
  narration          TEXT NOT NULL,
  reverses_entry_id  UUID UNIQUE REFERENCES journal_entries(id),
  created_by         UUID NOT NULL REFERENCES users(id),
  approved_by        UUID REFERENCES users(id),
  idempotency_key    TEXT UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((source_type = 'REVERSAL') = (reverses_entry_id IS NOT NULL)),
  CHECK (source_type <> 'POST_LOCK_CORRECTION' OR approved_by IS NOT NULL)
);
CREATE INDEX journal_entries_day ON journal_entries (site_id, business_date);
CREATE INDEX journal_entries_source ON journal_entries (source_type, source_id);
SELECT make_fact_table('journal_entries');
GRANT USAGE ON SEQUENCE journal_entries_entry_no_seq TO pump_app;

CREATE TABLE journal_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id      UUID NOT NULL REFERENCES journal_entries(id),
  line_no       SMALLINT NOT NULL CHECK (line_no > 0),
  account_id    UUID NOT NULL REFERENCES accounts(id),
  party_kind    TEXT CHECK (party_kind IN ('CUSTOMER','SUPPLIER','EMPLOYEE','LENDER')),
  party_id      UUID,
  debit         NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit        NUMERIC(14,2) NOT NULL DEFAULT 0,
  mode_code     TEXT REFERENCES payment_modes(code),
  station_id    UUID REFERENCES stations(id),
  fuel_type_id  UUID REFERENCES fuel_types(id),
  litres        NUMERIC(12,3) CHECK (litres IS NULL OR litres >= 0),
  vehicle_no    TEXT,
  UNIQUE (entry_id, line_no),
  CHECK (debit >= 0 AND credit >= 0),
  CHECK ((debit = 0) <> (credit = 0)),                       -- exactly one side, non-zero
  CHECK ((party_kind IS NULL) = (party_id IS NULL))
);
CREATE INDEX journal_lines_account ON journal_lines (account_id);
CREATE INDEX journal_lines_party ON journal_lines (party_kind, party_id) WHERE party_id IS NOT NULL;
SELECT make_fact_table('journal_lines');

-- Entry-level guard: lock-day rule and correction rules.
CREATE FUNCTION trg_journal_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status TEXT; v_role TEXT;
BEGIN
  v_status := lock_business_day_for_posting(NEW.site_id, NEW.business_date);
  IF v_status = 'LOCKED' AND NEW.source_type NOT IN ('POST_LOCK_CORRECTION','SALES_RECLASS')
     AND NOT (NEW.source_type = 'REVERSAL' AND NEW.approved_by IS NOT NULL) THEN
    RAISE EXCEPTION 'DAY_LOCKED: business day % is locked; only an owner correction can post to it',
      NEW.business_date USING ERRCODE = 'P0002';
  END IF;
  IF NEW.source_type IN ('POST_LOCK_CORRECTION','SALES_RECLASS') OR
     (NEW.source_type = 'REVERSAL' AND v_status = 'LOCKED') THEN
    SELECT role_code INTO v_role FROM users WHERE id = NEW.approved_by;
    IF v_role IS DISTINCT FROM 'OWNER' THEN
      RAISE EXCEPTION 'Changes to a locked day must be approved by the owner';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_entry_guard BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION trg_journal_entry_guard();

-- Line-level guard: account active, source allowed on account, party rules.
CREATE FUNCTION trg_journal_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a accounts%ROWTYPE; e journal_entries%ROWTYPE;
BEGIN
  SELECT * INTO a FROM accounts WHERE id = NEW.account_id;
  SELECT * INTO e FROM journal_entries WHERE id = NEW.entry_id;
  IF NOT a.active THEN
    RAISE EXCEPTION 'Account % is inactive', a.code;
  END IF;
  -- Reversals and owner corrections may touch any account; reversals are mirror-checked at commit.
  IF e.source_type NOT IN ('REVERSAL','POST_LOCK_CORRECTION')
     AND NOT (e.source_type = ANY (a.allowed_sources)) THEN
    RAISE EXCEPTION 'POSTING_RULE: % entries cannot post to account % (%)',
      e.source_type, a.code, a.name_en USING ERRCODE = 'P0003';
  END IF;
  IF a.party_kind IS NOT NULL AND (NEW.party_kind IS DISTINCT FROM a.party_kind OR NEW.party_id IS NULL) THEN
    RAISE EXCEPTION 'Account % requires a % party', a.code, a.party_kind;
  END IF;
  IF a.party_kind IS NULL AND NEW.party_id IS NOT NULL THEN
    RAISE EXCEPTION 'Account % does not take a party', a.code;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_line_guard BEFORE INSERT ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION trg_journal_line_guard();

-- Deferred balance + reversal-mirror check, run once per entry at COMMIT.
CREATE FUNCTION check_journal_entry(p_entry UUID) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_dr NUMERIC; v_cr NUMERIC; v_n INT; v_rev UUID; v_mismatch INT;
BEGIN
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*)
    INTO v_dr, v_cr, v_n FROM journal_lines WHERE entry_id = p_entry;
  IF v_n < 2 THEN
    RAISE EXCEPTION 'UNBALANCED: journal entry % has % line(s); at least 2 required', p_entry, v_n
      USING ERRCODE = 'P0004';
  END IF;
  IF v_dr <> v_cr THEN
    RAISE EXCEPTION 'UNBALANCED: journal entry % debits % <> credits %', p_entry, v_dr, v_cr
      USING ERRCODE = 'P0004';
  END IF;
  SELECT reverses_entry_id INTO v_rev FROM journal_entries WHERE id = p_entry;
  IF v_rev IS NOT NULL THEN
    SELECT COUNT(*) INTO v_mismatch FROM (
      SELECT COALESCE(o.account_id, r.account_id) AS account_id
      FROM (SELECT account_id, party_id, SUM(debit - credit) AS net FROM journal_lines
              WHERE entry_id = v_rev GROUP BY account_id, party_id) o
      FULL JOIN (SELECT account_id, party_id, SUM(debit - credit) AS net FROM journal_lines
              WHERE entry_id = p_entry GROUP BY account_id, party_id) r
        ON o.account_id = r.account_id AND o.party_id IS NOT DISTINCT FROM r.party_id
      WHERE COALESCE(o.net, 0) + COALESCE(r.net, 0) <> 0
    ) m;
    IF v_mismatch > 0 THEN
      RAISE EXCEPTION 'REVERSAL_MISMATCH: entry % does not exactly reverse entry %', p_entry, v_rev
        USING ERRCODE = 'P0005';
    END IF;
  END IF;
END $$;

CREATE FUNCTION trg_journal_check_from_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM check_journal_entry(NEW.entry_id); RETURN NULL; END $$;
CREATE FUNCTION trg_journal_check_from_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM check_journal_entry(NEW.id); RETURN NULL; END $$;

CREATE CONSTRAINT TRIGGER journal_balanced_line AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_journal_check_from_line();
CREATE CONSTRAINT TRIGGER journal_balanced_entry AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_journal_check_from_entry();

-- ---------------------------------------------------------------------------
-- Read views
-- ---------------------------------------------------------------------------
CREATE VIEW v_trial_balance AS
SELECT a.code, a.name_en, a.type,
       COALESCE(SUM(l.debit),0) AS total_debit, COALESCE(SUM(l.credit),0) AS total_credit,
       COALESCE(SUM(l.debit - l.credit),0) AS balance
FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
GROUP BY a.id, a.code, a.name_en, a.type;

CREATE VIEW v_party_balances AS
SELECT l.party_kind, l.party_id, a.code AS account_code,
       SUM(l.debit) AS total_debit, SUM(l.credit) AS total_credit, SUM(l.debit - l.credit) AS balance,
       MAX(e.business_date) AS last_date
FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
WHERE l.party_id IS NOT NULL
GROUP BY l.party_kind, l.party_id, a.code;

GRANT SELECT ON v_trial_balance, v_party_balances TO pump_app, pump_backup;
