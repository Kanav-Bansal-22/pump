# Database Schema (PostgreSQL 16) — v2.0

Status: design for approval. DDL below is normative for intent; the exact migration SQL is written in Phases 2–4.

## 1. Conventions

| Item | Rule |
|---|---|
| Money | `NUMERIC(14,2)` |
| Litres | `NUMERIC(12,3)` |
| Meter readings | `NUMERIC(12,2)` (display value); cumulative value `NUMERIC(16,2)` |
| Rates | `NUMERIC(8,2)` |
| Floats | **forbidden** (CI check greps migrations for `real`, `double precision`, `float`) |
| Keys | `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` |
| Time | `TIMESTAMPTZ`, server-set (`now()` / `clock_timestamp()`); DB `timezone = 'Asia/Kolkata'` for display, hashes use UTC text |
| Business date | `DATE`, computed by server from clock + cut-over (Q3) |
| Rounding | `ROUND(x, 2)` half-up at **segment/line** level, then sum |
| Every row | `created_at`, `created_by` (user id), plus `idempotency_key` on client-originated facts |
| Table classes | **F** = immutable fact (no UPDATE/DELETE ever) · **W** = workflow (status column UPDATE only via state-machine trigger) · **C** = configuration (UPDATE allowed for owner, fully audited, history kept where it affects money) |

## 2. Database roles and grants

| Role | Login | Privileges |
|---|---|---|
| `postgres` (superuser) | yes, local only | Password sealed with owner; not used by app or scripts. |
| `pump_owner` | no (used via `SET ROLE` in migrations) | Owns all tables, triggers, functions. |
| `pump_migrator` | yes, local only | Member of `pump_owner`; used only by migration command. |
| `pump_app` | yes, local only | `SELECT, INSERT` on F tables; `SELECT, INSERT, UPDATE(status cols)` on W tables; `SELECT, INSERT, UPDATE` on C tables; **no DELETE anywhere**, no TRUNCATE, no DDL. EXECUTE on posting functions. |
| `pump_backup` | yes, local only | `SELECT` on all (for `pg_dump`). |

Immutability triggers (`BEFORE UPDATE OR DELETE ... RAISE EXCEPTION`) exist on every F table **and** fire for the table owner. `TRUNCATE` blocked by a `BEFORE TRUNCATE` statement trigger. Only a superuser can `ALTER TABLE ... DISABLE TRIGGER`; that is the residual risk handled by hash chains and independent anchors.

## 3. Tables

### 3.1 Access and configuration (Phase 2)

```sql
-- C tables
sites(id, name, address, timezone DEFAULT 'Asia/Kolkata', day_cutover TIME NOT NULL, ...)
stations(id, site_id, code UNIQUE, name, sort_order, active)
fuel_types(id, code UNIQUE CHECK (code IN ('PETROL','DIESEL', ...)), name_en, name_hi, colour)
tanks(id, site_id, fuel_type_id, name, capacity_litres NUMERIC(12,3), active)
tank_calibration(tank_id, chart_version INT, dip_mm NUMERIC(8,1), volume_litres NUMERIC(12,3),
                 PRIMARY KEY(tank_id, chart_version, dip_mm))
nozzles(id, station_id, tank_id, fuel_type_id, number SMALLINT, label,
        max_flow_lpm NUMERIC(6,2) DEFAULT 50, active, UNIQUE(station_id, number))
        -- CHECK via trigger: nozzle.fuel_type = tank.fuel_type
nozzle_service_status(id, nozzle_id, status IN ('ACTIVE','OUT_OF_SERVICE'), from_at, reason,
                      set_by)        -- F: history of service status; current = latest row
shifts(id, site_id, name, start_time, end_time, sort_order, active)
payment_modes(id, code UNIQUE, name_en, name_hi, kind IN ('CASH','UPI','CARD','BANK','CREDIT','OTHER'),
              clearing_account_id NULL, allowed_on_receipt BOOL, allowed_on_payment BOOL,
              allowed_on_sales_split BOOL)
              -- CUSTOMER_CREDIT: allowed_on_sales_split only (contradiction C12)
categories(id, kind IN ('RECEIPT','PAYMENT'), name_en, name_hi, account_id, system BOOL, active)
              -- each category maps to exactly one ledger account => posting rule
cash_drawers(id, site_id, station_id NULL, name, account_id UNIQUE, active)   -- Q2
bank_accounts(id, name, last4, account_id UNIQUE)
settings(key PRIMARY KEY, value JSONB, updated_by, updated_at)   -- thresholds; audited
settings_history(id, key, old_value, new_value, changed_by, changed_at)        -- F

-- Auth
roles(id, code IN ('OWNER','MANAGER','EMPLOYEE'), name)
permissions(code PRIMARY KEY, description)       -- e.g. meter.enter, meter.review, meter.event.approve,
                                                 -- price.activate, tests.record, receipt.create,
                                                 -- payment.create, customer.manage, closing.lock,
                                                 -- closing.override, report.financial, settings.manage
role_permissions(role_id, permission_code)
user_permission_overrides(user_id, permission_code, granted BOOL)   -- manager customisation
users(id, name, username UNIQUE, password_hash, role_id, active, must_change_password,
      failed_logins, locked_until, created_at)
user_stations(user_id, station_id, PRIMARY KEY(user_id, station_id))
sessions(id, user_id, token_hash UNIQUE, device_id, created_at, expires_at, revoked_at, ip, user_agent)
pin_devices(id, user_id, device_token_hash UNIQUE, pin_hash, failed_pins, created_at, revoked_at)
login_attempts(id, username, ip, at, success, reason)                    -- F
idempotency_keys(key PRIMARY KEY, user_id, endpoint, request_hash BYTEA, response JSONB,
                 status_code INT, created_at)                            -- F
employees(id, user_id NULL UNIQUE, name, phone, default_station_id, monthly_salary, active)
```

### 3.2 Business days and audit (Phase 2)

```sql
business_days(                                   -- W
  id, station_id, business_date, status IN ('OPEN','SUBMITTED','LOCKED'),
  submitted_by, submitted_at, locked_by, locked_at, override_reason NULL,
  snapshot_id NULL, UNIQUE(station_id, business_date))
-- Allowed transitions: OPEN→SUBMITTED→LOCKED, SUBMITTED→OPEN (manager/owner reject).
-- Every posting function: SELECT ... FROM business_days WHERE ... FOR SHARE;
-- lock function: SELECT ... FOR UPDATE  (decision D8)

audit_log(                                       -- F
  id BIGSERIAL, at TIMESTAMPTZ DEFAULT clock_timestamp(), user_id, action, table_name, record_id,
  old_value JSONB, new_value JSONB, reason, approver_id, ip, device_id, request_id)
-- Generic AFTER INSERT/UPDATE trigger on all F/W/C tables; app sets
-- SET LOCAL app.user_id / app.request_id / app.ip per transaction.

app_errors(id, at, level, message, stack, user_id, request_id)
```

### 3.3 Meters, tests, prices (Phase 3)

```sql
meter_epochs(                                    -- F
  id, nozzle_id, epoch INT, int_digits SMALLINT, decimals SMALLINT,
  modulus NUMERIC(16,2) GENERATED ALWAYS AS (power(10, int_digits)) STORED,
  meter_serial TEXT, started_by_event_id NULL, created_at,
  UNIQUE(nozzle_id, epoch))
  -- epoch 1 created at go-live; a new row only via approved RESET/REPLACEMENT

meter_points(                                    -- F (append-only, hash-chained)
  id UUID PK, nozzle_id, seq BIGINT,            -- log order, trigger-assigned, contiguous per nozzle
  epoch INT, wrap_count INT NOT NULL DEFAULT 0 CHECK (wrap_count >= 0),
  reading NUMERIC(12,2) NOT NULL CHECK (reading >= 0),
  cumulative NUMERIC(16,2) NOT NULL,             -- = reading + wrap_count*modulus (trigger-checked)
  point_type IN ('BASELINE','SHIFT_END','DAY_END','PRICE_CHANGE','ROLLOVER',
                 'EVENT_END','EVENT_START','GAP_BOUNDARY'),
  business_date DATE, shift_id NULL,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),   -- server time of insert
  effective_at TIMESTAMPTZ NOT NULL,             -- = taken_at, except retro points (corrections,
                                                 --   price-session captures, gap boundaries)
  entered_by, device_id, ip,
  photo_id NULL REFERENCES attachments,
  supersedes_id NULL REFERENCES meter_points,    -- correction replacement
  meter_event_id NULL, price_change_id NULL, verification_id NULL,
  is_estimate BOOL DEFAULT false,                -- APPROVED_ESTIMATE retro split
  idempotency_key UNIQUE, prev_hash BYTEA, row_hash BYTEA NOT NULL,
  UNIQUE(nozzle_id, seq), FOREIGN KEY (nozzle_id, epoch) REFERENCES meter_epochs(nozzle_id, epoch))

CREATE UNIQUE INDEX one_boundary_per_shift ON meter_points (nozzle_id, business_date, shift_id)
  NULLS NOT DISTINCT WHERE point_type IN ('SHIFT_END','DAY_END') AND supersedes_id IS NULL;  -- D4g
CREATE INDEX ON meter_points (nozzle_id, effective_at, seq);

meter_point_rejections(id, point_id UNIQUE, review_id, at)   -- F (point removed from live chain)

meter_verifications(                             -- F (D4c: NOT a chain point)
  id, nozzle_id, verified_value NUMERIC(12,2), carried_point_id, carried_value,
  matches BOOL, business_date, shift_id, verified_by, verified_at, photo_id, idempotency_key UNIQUE)

meter_events(                                    -- W
  id, nozzle_id, event_type IN ('ROLLOVER','RESET','REPLACEMENT'),
  status IN ('REQUESTED','APPROVED','REJECTED','APPLIED'),
  requested_by, requested_at, observed_at,       -- when the reading was physically taken
  proposed_reading NUMERIC(12,2) NULL,           -- ROLLOVER: new low reading
  old_final_reading NUMERIC(12,2) NULL,          -- RESET/REPLACEMENT
  new_start_reading NUMERIC(12,2) NULL,
  new_int_digits SMALLINT NULL, new_decimals SMALLINT NULL,
  old_serial, new_serial, reason TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
  evidence_photo_id NOT NULL)
meter_event_decisions(id, event_id, decision IN ('APPROVE','REJECT'), decided_by, decided_at, reason,
  CHECK constraint via trigger: decided_by <> event.requested_by)   -- F, four-eyes (no owner exception)

nozzle_tests(                                    -- F
  id, nozzle_id, business_date, tested_at DEFAULT clock_timestamp(),
  litres NUMERIC(8,3) CHECK (litres > 0), returned_to_tank BOOL NOT NULL,
  purpose IN ('QUANTITY_CHECK','QUALITY_CHECK','INSPECTION','OTHER'),
  not_returned_reason TEXT, employee_id, idempotency_key UNIQUE,
  CHECK (returned_to_tank OR length(trim(not_returned_reason)) > 0))
nozzle_test_voids(id, test_id UNIQUE, reason, voided_by, approved_by, at)    -- F (replaces voided_by_id)

price_change_sessions(                           -- W (D4d)
  id, site_id, fuel_type_id, old_price, new_price CHECK (new_price > 0),
  mode IN ('LIVE','RETRO_ESTIMATE'), status IN ('OPEN','COMMITTED','ABANDONED','EXPIRED'),
  opened_by, opened_at, expires_at, committed_at, approved_by NULL, reason, evidence_photo_id NULL)
price_change_captures(                           -- F
  id, session_id, nozzle_id, reading NUMERIC(12,2), captured_at DEFAULT clock_timestamp(),
  captured_by, photo_id, UNIQUE(session_id, nozzle_id))
fuel_prices(                                     -- F
  id, site_id, fuel_type_id, price NUMERIC(8,2) CHECK (price > 0), effective_from TIMESTAMPTZ,
  price_change_session_id, UNIQUE(site_id, fuel_type_id, effective_from))
  -- used for the DEFAULT rate on new credit sales and the baseline; segment valuation uses the chain.

meter_flags(id, nozzle_id, point_id NULL, verification_id NULL, segment_ref JSONB, business_date,
            code, severity IN ('REVIEW','INFO'), detail JSONB, raised_at)        -- F
meter_reviews(id, flag_id, decision IN ('ACCEPT_AS_IS','CORRECT','REJECT','ALLOCATE_DAYS',
              'ATTRIBUTE_GAP','DISMISS_VERIFIER_TYPO','MARK_NO_SALE'),
              reason CHECK (length(trim(reason)) >= 5), reviewer_id, reviewed_at,
              self_review BOOL, replacement_point_id NULL, gap_point_id NULL,
              allocation JSONB NULL, gap_attribution NULL)                       -- F
              -- trigger: reviewer <> point.entered_by unless reviewer is OWNER (then self_review=true)
              -- trigger: allocation values sum exactly to segment litres
meter_entry_attempts(id, nozzle_id, user_id, attempted_value TEXT, expected_min, outcome,
                     rule_code, at, device_id, ip)                               -- F
```

**Derived views**
- `v_meter_points_live`: points not superseded and not rejected; status ACCEPTED / PENDING_REVIEW derived from open REVIEW flags.
- `v_meter_segments`: `LAG` over live points **ordered by (effective_at, seq)** per nozzle (decision D4a). It yields:
  - kind: NORMAL, ROLLOVER, EVENT_BRIDGE (0 L), GAP, MULTI_DAY
  - throughput = `cumulative_end − cumulative_start` within an epoch; 0 across epochs
  - tests_returned, tests_not_returned (tests whose `tested_at` lies in the segment's time window, excluding voided tests)
  - customer_litres, net_tank_depletion
  - price = latest PRICE_CHANGE point's session price at or before the segment start in this nozzle's chain, else the baseline price
  - sales_value = ROUND(customer_litres × price, 2)
  - confirmed = both endpoints ACCEPTED, and the kind is not GAP or unallocated MULTI_DAY (D4e)
- `v_nozzle_day`: per nozzle per business date (confirmed and provisional separated).
- **Write-time guards** (trigger + service):
  - a retro point must lie strictly between its live neighbours in `effective_at` **and** `cumulative`
  - a non-retro point must have `cumulative` ≥ the latest live point in the same epoch (H3)
  - `seq` assigned under `SELECT ... FROM nozzles WHERE id = $1 FOR UPDATE`

### 3.4 Stock (Phase 3)

```sql
dip_readings(id, tank_id, business_date, kind IN ('OPENING','CLOSING','PRE_DELIVERY','POST_DELIVERY','SPOT'),
             dip_mm, water_mm, chart_version, volume_litres, taken_at, taken_by, delivery_id NULL,
             idempotency_key UNIQUE)                                             -- F
fuel_deliveries(id, tank_id, supplier_id, supplier_bill_id NULL, invoice_no, invoiced_litres,
                density, temperature, pre_dip_id, post_dip_id, measured_litres GENERATED/derived,
                decant_started_at, decant_ended_at, received_by, idempotency_key UNIQUE)  -- F
stock_adjustments(                               -- F  (Correction B)
  id, tank_id, business_date,
  source_kind IN ('NOZZLE_TEST','DELIVERY_SHORTAGE','DIP_ALIGNMENT','OTHER_APPROVED'),
  nozzle_test_id NULL, delivery_id NULL,
  quantity_effect NUMERIC(12,3) NOT NULL,        -- signed litres applied to BOOK stock
  treatment TEXT, reason NOT NULL, requested_by, approved_by,
  CHECK (source_kind <> 'NOZZLE_TEST' OR (nozzle_test_id IS NOT NULL AND quantity_effect = 0)),
  CHECK (source_kind = 'NOZZLE_TEST' OR approved_by IS NOT NULL))
tank_baselines(id, tank_id, as_of TIMESTAMPTZ, opening_litres, dip_id)  -- F (go-live)
```
View `v_tank_day`:
- `book_open(d) = book_close(d-1)`; on the first day, the go-live baseline
- `book_close(d) = book_open(d) + Σ invoiced deliveries − Σ net_tank_depletion(nozzles on tank) + Σ quantity_effect`
- `variation = closing_dip − book_close`
- `stock_loss_tests = Σ tests not returned`, a **report-only** column, never subtracted again

### 3.5 Ledger and money (Phase 2 core, Phase 4 use)

```sql
accounts(                                        -- C (system rows seeded, owner can add expense/income)
  id, code UNIQUE, name_en, name_hi,
  type IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE'),
  subtype (CASH, BANK, CLEARING, RECEIVABLE, PAYABLE, SUSPENSE, FUEL_REVENUE, FUEL_REVENUE_UNCONFIRMED,
           OTHER_REVENUE, COGS, OPEX, EQUITY_OPENING, ...),
  party_kind NULL IN ('CUSTOMER','SUPPLIER','EMPLOYEE'),    -- requires party on lines
  allowed_sources TEXT[] NOT NULL,                           -- posting-rule guard (D3)
  system BOOL, active)

journal_entries(                                 -- F
  id, entry_no BIGSERIAL UNIQUE, business_date, station_id NULL, site_id,
  source_type IN ('CREDIT_SALE','CUSTOMER_REPAYMENT','OTHER_RECEIPT','EXPENSE_PAYMENT',
                  'SUPPLIER_BILL','SUPPLIER_PAYMENT','INTERNAL_TRANSFER','BANK_DEPOSIT',
                  'BANK_WITHDRAWAL','UPI_SETTLEMENT','CARD_SETTLEMENT','SALES_DECLARATION',
                  'DAY_SALES_POST','SALES_RECLASS','CASH_COUNT_DIFFERENCE','SUSPENSE_RESOLUTION',
                  'OPENING_BALANCE','REVERSAL','POST_LOCK_CORRECTION','SALARY_PAYMENT',
                  'STAFF_ADVANCE'),
  source_id UUID,                                -- the source document (receipt, payment, ...)
  narration, reverses_entry_id NULL REFERENCES journal_entries UNIQUE,
  created_by, approved_by NULL, idempotency_key UNIQUE, created_at)
journal_lines(                                   -- F
  id, entry_id, account_id, party_kind NULL, party_id NULL,
  debit NUMERIC(14,2) DEFAULT 0, credit NUMERIC(14,2) DEFAULT 0,
  mode_id NULL, station_id NULL, fuel_type_id NULL, litres NUMERIC(12,3) NULL, vehicle_no NULL,
  CHECK (debit >= 0 AND credit >= 0 AND (debit = 0) <> (credit = 0)))
-- DEFERRABLE INITIALLY DEFERRED constraint trigger: Σdebit = Σcredit per entry, ≥ 2 lines.
-- BEFORE INSERT trigger on journal_lines: entry.source_type = ANY(account.allowed_sources);
--   party required iff account.party_kind not null; business_day of (station,date) not LOCKED
--   unless source_type = 'POST_LOCK_CORRECTION' (owner only, function-checked).

-- Source documents (what the employee actually filled in) — F
receipts(id, receipt_no, business_date, station_id, drawer_id NULL, category_id, mode_id, amount > 0,
         description, customer_id NULL, reference, remarks, entered_by, journal_entry_id UNIQUE,
         idempotency_key UNIQUE)
payments(id, payment_no, business_date, station_id, drawer_id NULL, category_id NULL,
         purpose IN ('EXPENSE','SUPPLIER_BILL_PAYMENT','SALARY','STAFF_ADVANCE','OWNER_DRAWING','OTHER'),
         mode_id, amount > 0, description, supplier_id NULL, supplier_bill_id NULL, employee_id NULL,
         reference, remarks, attachment_id NULL, entered_by, journal_entry_id UNIQUE,
         idempotency_key UNIQUE)
credit_sales(id, slip_no, business_date, station_id, nozzle_id NULL, customer_id, vehicle_no,
             fuel_type_id, litres NULL, rate, amount > 0, entered_by, journal_entry_id UNIQUE,
             idempotency_key UNIQUE)
sales_declarations(id, business_date, station_id, drawer_id, shift_id NULL, mode_id,
                   total_received NUMERIC(14,2) >= 0,        -- D10: TOTAL seen on UPI app / card machine
                   declared_by, declared_at, supersedes_id NULL, idempotency_key UNIQUE)
transfers(id, business_date, from_account_id, to_account_id, amount > 0, reference, entered_by,
          journal_entry_id UNIQUE, idempotency_key UNIQUE)   -- deposits, withdrawals, drawer↔drawer
settlements(id, mode_id, provider, period_from, period_to, gross, charges, net_received,
            bank_account_id, bank_date, reference, journal_entry_id UNIQUE, status ...)
cash_counts(id, drawer_id, business_date, shift_id NULL, counted_amount, denominations JSONB NULL,
            expected_amount, difference, counted_by, witnessed_by NULL, at,
            journal_entry_id NULL, idempotency_key UNIQUE)  -- F
suspense_resolutions(id, cash_count_id, resolution IN ('RECOVERED_FROM_STAFF','WRITTEN_OFF','FOUND_ERROR'),
                     amount, reason, approved_by, journal_entry_id)              -- F
corrections(id, original_table, original_id, reversal_entry_id, replacement_entry_id NULL,
            reason, requested_by, approved_by, after_lock BOOL, at)              -- F
```

**Views:** `v_customer_ledger`, `v_customer_balance`, `v_supplier_ledger`, `v_supplier_balance`, `v_cashbook` (per drawer, running balance), `v_bank_book`, `v_trial_balance`, `v_pnl`, `v_collections_by_mode`.
- Customer and supplier balances are **never stored**. They are always sums over `journal_lines`.

### 3.6 Parties and import (Phase 4)

```sql
customers(id, name, phone, address, gst_no NULL, credit_limit NULL, active,
          name_normalized, phone_normalized)  -- C; index for duplicate detection
customer_vehicles(id, customer_id, vehicle_no UNIQUE)
suppliers(id, name, phone, gst_no, kind IN ('FUEL_OMC','OTHER'), payment_terms_days, active)
supplier_bills(id, supplier_id, bill_no, bill_date, due_date, amount, category_id (fuel purchase /
               expense), delivery_id NULL, attachment_id, journal_entry_id UNIQUE,
               UNIQUE(supplier_id, bill_no))   -- F
import_batches(id, kind IN ('CUSTOMER_OPENING','SUPPLIER_OPENING'), file_sha256 UNIQUE, file_name,
               status IN ('PREVIEW','CONFIRMED','CANCELLED'), row_count, total_amount,
               typed_total_confirmation, register_total, reconciled BOOL, created_by, confirmed_by,
               confirmed_at)                                                     -- W
import_rows(id, batch_id, row_no, raw JSONB, name, phone, address, opening_amount, remarks,
            status IN ('VALID','DUPLICATE_IN_FILE','DUPLICATE_EXISTING','ERROR'), error,
            customer_id NULL, journal_entry_id NULL)                             -- F
attachments(id, path, mime, sha256, size, uploaded_by, at)                       -- F
```

### 3.7 Closing, integrity, ops, future

```sql
day_snapshots(id, station_id, business_date, kind IN ('LOCK','POST_LOCK_CORRECTION'),
              figures JSONB, nozzle_rows JSONB, ledger_digest BYTEA, meter_heads JSONB,
              integrity_code CHAR(8), created_by, created_at)                    -- F
integrity_runs(id, started_at, finished_at, kind IN ('NIGHTLY','ON_DEMAND','RESTORE_TEST'),
               ok BOOL, details JSONB)                                           -- F
backup_log(id, kind IN ('HOURLY','NIGHTLY','MONTHLY'), started_at, finished_at, path, size,
           sha256, external_copy_ok, manifest_written, verified_ok, error)       -- F
payment_events(id, source, external_ref UNIQUE, raw JSONB, parsed JSONB, received_at,
               matched_entry_id NULL)          -- FUTURE: table only, no code
integrations(id, kind, enabled BOOL DEFAULT false, config JSONB)   -- FUTURE: no secrets stored
```

## 4. Concurrency rules

| Operation | Lock |
|---|---|
| Meter point insert | `nozzles` row `FOR UPDATE` → read latest live point → validate → insert (seq, hash) |
| Price-change commit | All affected nozzles `FOR UPDATE` in id order (no deadlocks) |
| Any posting | `business_days` row `FOR SHARE` |
| Day lock | `business_days` row `FOR UPDATE`, then snapshot |
| Credit sale with limit check | `pg_advisory_xact_lock(hashtext(customer_id))` |
| Import confirm | `import_batches` row `FOR UPDATE`; status must be PREVIEW |
| Isolation | READ COMMITTED + explicit locks above; integration tests run 20 parallel clients |

## 5. Weaknesses fixed vs v1.0/v1.1

1. Segments ordered by `seq` would break after corrections (D4a).
2. `meter_epoch` and digit count stored on the nozzle would break rollover maths after a replacement (D4b).
3. "Append-only" tables that needed UPDATE (D5).
4. `UNIQUE(nozzle, date, shift)` lost in v1.1, which allowed two day-ends (D4g).
5. NULL `shift_id` would make uniqueness ineffective; fixed with `NULLS NOT DISTINCT`.
6. Lock-vs-insert race (D8).
7. Idempotency without a stored response or request hash (D9).
8. `tank_adjustments` double deduction (D6).
9. Customer, supplier and cash ledgers stored separately could drift; now one journal (D3).
10. The hash input omitted fields that matter (business_date, supersedes, event links, photo hash); the full canonical input is in SECURITY §4.
11. Tanks keyed to stations (D2).
12. No DB-level guard that revenue comes only from meter sales; now `allowed_sources` (D3).
