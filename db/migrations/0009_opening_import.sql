-- 0009_opening_import: customer opening balances from the old handwritten register.
-- One OPENING_BALANCE journal per customer (Dr 1400 customer / Cr 3100 opening equity; reverse for an
-- advance). Never revenue. Batches are hash-tracked so the same file can never be imported twice.

CREATE TABLE import_batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL CHECK (kind IN ('CUSTOMER_OPENING')),
  file_name       TEXT NOT NULL,
  file_sha256     TEXT NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  status          TEXT NOT NULL DEFAULT 'PREVIEW' CHECK (status IN ('PREVIEW','CONFIRMED','CANCELLED')),
  opening_date    DATE NOT NULL,
  row_count       INT NOT NULL,
  file_total      NUMERIC(14,2) NOT NULL,
  register_total  NUMERIC(14,2),          -- typed by the owner from the old register at confirmation
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  confirmed_by    UUID REFERENCES users(id),
  confirmed_at    TIMESTAMPTZ
);
-- the same file can be confirmed only once
CREATE UNIQUE INDEX import_batches_one_confirmed_file ON import_batches (file_sha256) WHERE status = 'CONFIRMED';
SELECT make_workflow_table('import_batches');

CREATE FUNCTION trg_import_batch_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.file_sha256 <> OLD.file_sha256 OR NEW.file_total <> OLD.file_total
     OR NEW.row_count <> OLD.row_count OR NEW.opening_date <> OLD.opening_date OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'import batch contents cannot change';
  END IF;
  IF NOT (OLD.status = 'PREVIEW' AND NEW.status IN ('CONFIRMED','CANCELLED')) THEN
    RAISE EXCEPTION 'import batch transition % -> % not allowed', OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'CONFIRMED' AND (NEW.register_total IS DISTINCT FROM NEW.file_total OR NEW.confirmed_by IS NULL) THEN
    RAISE EXCEPTION 'an import is confirmed only when the old register total equals the file total';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER import_batch_transition BEFORE UPDATE ON import_batches FOR EACH ROW EXECUTE FUNCTION trg_import_batch_transition();

CREATE TABLE import_rows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    UUID NOT NULL REFERENCES import_batches(id),
  row_no      INT NOT NULL,
  raw         JSONB NOT NULL,
  name        TEXT,
  phone       TEXT,
  address     TEXT,
  amount      NUMERIC(14,2),
  remarks     TEXT,
  status      TEXT NOT NULL CHECK (status IN ('NEW','MATCH_EXISTING','ERROR')),
  match_party_id UUID REFERENCES parties(id),
  error       TEXT,
  UNIQUE (batch_id, row_no)
);
SELECT make_fact_table('import_rows');

-- What each row became when the batch was confirmed.
CREATE TABLE import_row_results (
  row_id            UUID PRIMARY KEY REFERENCES import_rows(id),
  party_id          UUID NOT NULL REFERENCES parties(id),
  journal_entry_id  UUID NOT NULL UNIQUE REFERENCES journal_entries(id)
);
SELECT make_fact_table('import_row_results');

-- One opening balance per customer, whether imported or typed in one at a time.
CREATE TABLE opening_balances (
  party_id          UUID PRIMARY KEY REFERENCES parties(id),
  amount            NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
  opening_date      DATE NOT NULL,
  remarks           TEXT,
  import_row_id     UUID UNIQUE REFERENCES import_rows(id),
  journal_entry_id  UUID NOT NULL UNIQUE REFERENCES journal_entries(id),
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
SELECT make_fact_table('opening_balances');
