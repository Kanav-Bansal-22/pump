# Implementation Roadmap — v2.0

Phases follow the master prompt (Part 18). A phase is **complete only when its exit tests pass** and the phase report has been delivered. The report lists what was built, files, DB changes, tests run, results, known issues, remaining work and run commands.

## Progress checklist

- [x] **Phase 0 — Understand and validate** (repo inspected: empty; v1.0 + v1.1 + master read; spreadsheets checked: templates only)
- [x] **Phase 1 — Architecture deliverables written** (this folder)
- [x] Phase 1 — Owner approval (staged go-live approved 2026-11-11); some answers still open (OPEN_QUESTIONS)
- [ ] Phase 2 — Foundation **(in progress)**
  - [x] Repo, Next.js 16 + TypeScript project, scripts
  - [x] DB setup script (restricted roles, prod/demo/test databases), migration runner with checksums
  - [x] Migrations 0001–0005: immutability/audit/workflow helpers, config, auth, business days, ops, future hooks, chart of accounts, journal + posting guards
  - [x] 24 foundation DB tests passing (roles, immutability incl. owner role, audit, balance, posting rules, reversals, day lock, lock race)
  - [x] PostgreSQL 16.15 installed on the server laptop (2026-11-11): Windows service, automatic start, listening on localhost only, timezone Asia/Kolkata; pgAdmin/Stack Builder not installed; pump_prod / pump_demo / pump_test migrated; smoke check as pump_app passed (`npx tsx scripts/smoke-check.ts`)
  - [x] Migration 0006: secrets (password/PIN/token hashes) redacted from audit_log; session heartbeats not audited
  - [x] Login (argon2id, 5-try lockout, attempts logged), sessions (hashed tokens, HTTP-only SameSite=Strict cookie), logout, forced password change, owner reset / disable / sign-out-all-phones
  - [x] Permission checks on every API route + page guards; origin check on every POST
  - [x] First-run owner setup; owner screens: pump layout (confirmed 3 stations / 6 nozzles), site, station and nozzle names, staff logins
  - [x] Idempotent API layer (stored responses, conflict detection, parallel double-tap safe)
  - [x] Bilingual mobile UI shell with saved / NOT-saved states and DEMO banner
  - [x] 42 automated tests passing; browser check on demo DB (owner setup → layout → staff login → forced password → staff blocked from owner page and API → foreign-origin POST blocked)
  - [ ] PIN quick-login (deferred to Phase 6; Chrome's saved password covers it for go-live)
  - [ ] Daily rates screen (moved to Phase 3 with the meter tables)
  - [ ] SSE live updates
  - [x] Backups (2026-11-11): `npm run backup` (pg_dump as read-only role → archive verified with pg_restore --list → SHA-256 → hash-linked `backups/manifest.jsonl` with meter chain heads → backup_log → pruning 48 h hourly / 30 daily + 12 monthly / 20 manual); owner "Back up now", backup list, download-to-phone (recorded), health card, red home warning after 26 h; restore round-trip test (TC-31)
  - [x] Scheduled backups registered on the server laptop (owner OK 2026-11-11): "PetrolPump Nightly Backup" daily 02:00; "PetrolPump Hourly Backup" daily 07:00 repeating hourly for 16 h; run on battery, catch up missed runs, 30-min limit; test run via Task Scheduler succeeded (result 0, file written, 0 chain problems). Log: `backups/task.log`
- [ ] Phase 3 — Meter and fuel management **(core done for go-live 1)**
  - [x] Migration 0007: daily rates (append-only, reason to change, locked-day guard), meter epochs, hash-chained append-only meter points, testing fuel + voids, blocked-attempt log, flags + owner review, segments view, chain verification + heads
  - [x] Business day 08:00 with closing window 05:00–11:00 (settings; reading time still to be confirmed)
  - [x] Staff entry: board, automatic opening, numeric entry, check screen (litres × rate = value), save; rules H1–H5 + duplicate-day block; flags zero / high / low / impossible rate / missed days; refused values logged at check and at save
  - [x] Owner: daily rates, starting readings (typed twice), day sheet like the register (missing nozzles in red, provisional marked), review queue
  - [x] 25 meter tests incl. register page 224 figures, TC-01..03, TC-07, TC-08 maths, TC-18, TC-19, TC-22/34, INV-11; browser check on demo DB
  - [ ] Meter events workflow (rollover / reset / replacement approval), corrections with approver, test-pour screen, multi-day allocation, price change inside the day, dip/stock (postponed by owner)
- [ ] Phase 4 — Accounting **(go-live 1 subset done, 2026-11-11)**
  - [x] Migration 0008: parties (customer / supplier / lender / staff), money entries (13 kinds = every Rokad line), reversals, cash counts, day snapshots, locked-day guard on readings, accounts 1150 (cash handed to owner) and 1200 (bank)
  - [x] Posting service: each entry posts its balanced journal in the same transaction; mode → cash / UPI clearing / card clearing / bank; owner-only kinds; day choice inside the 8–11 AM window; duplicate-phone check; owner cancel = exact reversal
  - [x] Day balance in the register's order; blind cash count (staff see figures only after counting); submit; owner send-back; owner lock with guards (missing readings, open flags: override with reason; missing rate / udhari > sales: never), posting fuel revenue (confirmed → 4100/4110, provisional → 4190), cash sales, short/excess → suspense, counted cash → owner; fuel-sales control asserted zero; snapshot + 8-char integrity code
  - [x] Screens: Udhari given / received, Payment / expense, Lube / other receipt, Close day, Udhari list with outstanding, customer statement (print / save as PDF)
  - [x] 10 money tests on the register-page-224 day (79 total passing); browser check on demo DB; production build + `next start` smoke test
  - [x] Customer opening-balance import (2026-11-11): migration 0009 (import batches with state machine and file SHA-256, rows, results, one opening balance per customer); Excel template; .xlsx / .csv with flexible headers; amounts with Indian commas, minus / "Cr" / brackets = advance; preview marks NEW / MATCH_EXISTING (phone, else unique exact name) / ERROR (missing or bad amount, bad phone, duplicates in file, template example row, ambiguous name, customer already has an old balance); confirm only with zero problem rows and the old register total equal to the file total; same file never twice; OPENING_BALANCE journals (never revenue); one-off "Add old balance" on a customer statement; 17 tests; browser check on demo DB
  - [ ] Supplier bills (HPCL invoices), UPI/card split + settlements (postponed by owner), post-lock corrections, statement PDF file + WhatsApp share
  - [ ] Backup script + phone download + health card
- [ ] Phase 3 — Meter and fuel management
- [ ] Phase 4 — Accounting
- [ ] Phase 5 — Daily closing and reports
- [ ] Phase 6 — Polish and deployment

## 0. Go-live around 15 Nov 2026 (**approved by owner 2026-11-11: staged go-live, paper register in parallel**)

Building and properly testing every phase takes longer than 4 days. Proposed staged go-live:

| Stage | Date (target) | Contents | Paper register |
|---|---|---|---|
| **Go-live 1** | ~15 Nov | Login (owner + staff), 6-nozzle daily readings with automatic litres, daily 8 AM rates, udhari given, udhari received, payments, lubricant sales, end-of-day cash count with difference, customer balances, daily summary screen in Rokad order, nightly backup + phone download | **Kept in parallel.** The owner compares the app's daily summary with the register every day for 2 weeks |
| Go-live 2 | +1–2 weeks | Customer opening-balance import, customer statements (PDF/print/WhatsApp), day lock + snapshot + integrity code, corrections workflow, meter events | Kept until totals match for 14 days in a row |
| Go-live 3 | following weeks | Reports and exports, owner dashboard extras, any postponed modules the owner switches on (UPI/card, stock, HPCL ledger) | Retired by owner decision |

Rules for Go-live 1:
- Accounting core (journal, guards, immutability, idempotency, meter chain) is **complete and tested** from day one. Only screens and reports are staged, never correctness.
- Real data goes into `pump_prod` only from the cut-over day. Everything before that is in `pump_demo` with the DEMO banner.
- Cut-over on the day: meter baselines (current reading of all 6 nozzles), today's rates, opening cash. Customer opening balances follow when the owner provides the old register (Go-live 2). Until then, customer balances in the app cover **new** transactions only, and the screen says so.

## 1. Phases

### Phase 2 — Foundation
- New git repo in `PUMP/`, Next.js + TypeScript strict, ESLint (no-float rule for money modules), Vitest, Playwright.
- Docker Compose **for development DB only**. Native Postgres 16 install script for the server.
- Migrations:
  - roles and grants
  - config tables (site, stations, nozzles, tanks, fuel types, shifts, payment modes, categories, drawers, banks, settings)
  - auth tables
  - `business_days`, `audit_log`, `idempotency_keys`, `attachments`
  - chart of accounts + `journal_entries`/`journal_lines` + balance trigger + `allowed_sources` guard
  - future `payment_events` / `integrations` (empty)
- Auth (password, sessions, PIN devices), RBAC + station scoping middleware.
- Configuration screens (owner), user management.
- Generic immutability, state-machine and audit triggers.
- SSE live channel.
- Backup script (hourly/nightly) + manifest writer + `backup_log` + health endpoint.
- `pump_demo` vs `pump_prod` separation with DEMO banner.
- **Exit tests:**
  - login on two phones; live event visible on both
  - every route denies unauthorised roles
  - immutability triggers deny UPDATE/DELETE/TRUNCATE (owner role too)
  - unbalanced journal rejected; disallowed source→account rejected
  - idempotent replay returns the same response; changed body rejected
  - backup + manifest written; restore of the foundation DB succeeds

### Phase 3 — Meter and fuel management
- `meter_epochs`, `meter_points` (seq + hash triggers), verifications, events + decisions, tests + voids, price sessions + captures, `fuel_prices`, flags, reviews, attempts, stock tables.
- Entry UI: nozzle cards, keypad, confirmation, saved/not-saved states, test-pour button.
- Rules H1–H9, flags F1–F14, missing-reading job.
- Event workflow, price-change session, retro split, corrections, review queue.
- Views: live points, segments, nozzle-day, tank-day.
- Six-nozzle dashboard + chain drill-down + integrity panel (chain verification).
- **Exit tests:** TC-01 … TC-41 (below) all passing.

### Phase 4 — Accounting
- Posting engine for every event in ACCOUNTING_WORKFLOWS §6.
- Screens: credit sale, repayment, receipt, payment (bill vs expense), transfers/deposits, settlements, sales declarations (UPI/card totals), cash count.
- Customers + vehicles, opening-balance import (preview, hash, typed total, reconcile flag), statements (PDF/print/share).
- Suppliers, bills, payments, statements.
- Cashbook (station / consolidated / drawer), reconciliation view, expense categories.
- **Exit tests:** INV-01 … INV-09, INV-12, import tests IMP-01 … IMP-06, concurrency on customer ledger (20 parallel credit sales → exact sum).

### Phase 5 — Daily closing and reports
- Closing screen (tiles, drill-down), submit/lock guards, override with reason, lock postings (#12–#14), snapshots, integrity code, post-lock corrections, SALES_RECLASS.
- Owner dashboard (live), 22 reports with date/station filters, PDF/Excel/print.
- **Exit tests:** INV-10, INV-11, INV-13, INV-14, TC-24, TC-29; every tile's drill-down rows sum to the tile; PDF/Excel totals equal on-screen totals.

### Phase 6 — Polish and deployment
- Mobile refinements, Hindi/English labels, PWA manifest + service worker (app shell only, no data queue).
- Caddy HTTPS + phone CA guide, Windows services (Postgres, app, Caddy), firewall rules, power settings script.
- Monthly restore test job, integrity nightly job, audit viewer.
- Error handling review.
- Docs: `INSTALL.md`, `RESTORE.md`, `MIGRATE.md`, `EMPLOYEE_GUIDE.md` (Hindi + English, with pictures), `OWNER_GUIDE.md`, `GO_LIVE_CUTOVER.md`.
- Rehearse go-live with **demo** DB, then real cut-over (D15).
- **Exit tests:**
  - reboot test: app back with nobody logged in
  - Wi-Fi drop mid-save shows NOT saved; retry gives no duplicate
  - power-pull test on the DB (UPS removed, test DB)
  - full restore onto a second machine; chains and manifest verify (TC-31, TC-35)

## 2. Meter test catalogue (Phase 3)

TC-01 … TC-32 from addendum v1.1 are kept, with these changes:
- **TC-08** rollover also asserts: epoch unchanged, `wrap_count` = 1, no bridge segment, event approved by a different user.
- **TC-13** rewritten for D4c: the verification is not a chain point. The gap appears only after the reviewer chooses "real gap"; a verifier-typo dismissal leaves the chain unchanged.
- **TC-17** changed for D4f: a test entry above the max is blocked at entry. Tests > throughput at closing → F9 flag (point stored, provisional), not a block.
- **TC-22** extended to the owner role and TRUNCATE.

New tests:

| # | Scenario | Expected |
|---|---|---|
| TC-08b | Rollover requested by owner, approved by owner | Denied (four-eyes, no owner exception for events) |
| TC-08c | Second rollover in same epoch | wrap_count 2; litres via modulus; INV-11 holds |
| TC-33 | Replacement meter with 8 integer digits | New `meter_epochs` row; rollover modulus 100,000,000 applies after it; H2 uses new digits |
| TC-34 | Superuser edits reading with triggers disabled | Nightly verification fails, dashboard alert |
| TC-35 | Superuser rewrites reading and recomputes chain | Internal check passes; manifest / printed code comparison fails |
| TC-36 | Price session: nozzle A captured 10:00, B 10:04; B dispenses 20 L between | B's 20 L at **old** price; A's post-10:00 litres at new price |
| TC-37 | Price session open → employee enters day-end on that nozzle | Blocked with message; nothing written |
| TC-38 | Price session expires | Nothing written; old price stays; session EXPIRED |
| TC-39 | Lower verification value | Not inserted into chain; F8; resolution path = correction of closing |
| TC-40 | Provisional confirmed rule | Flag on point P_k makes only the two adjacent segments provisional; earlier and later segments stay confirmed |
| TC-41 | Manifest tamper | Manifest line-chain breaks; alert |
| TC-42 | Two employees enter DAY_END for same nozzle/day (non-stale) | Second rejected by unique index (D4g) |
| TC-43 | Retro correction outside neighbours | Rejected |
| TC-44 | Segment ordering after correction | Segments computed by (effective_at, seq) match expected; seq-ordering would differ (regression guard) |
| TC-45 | Delivery with linked `DELIVERY_SHORTAGE` | Stock reduced once by approved quantity; measured vs invoiced shown |

## 3. Accounting & import tests (Phase 4–5)

INV-01 … INV-14 (ACCOUNTING_WORKFLOWS §11), plus:

| # | Scenario | Expected |
|---|---|---|
| ACC-01 | ₹20,000 credit sale to ABC Transport | ABC outstanding +20,000 live; dashboard credit-sales tile +20,000; revenue unchanged until lock; at lock revenue = meter value (not +20,000 extra) |
| ACC-02 | UPI repayment ₹5,000 + UPI declared total ₹50,000 | UPI sales = ₹45,000; repayment not revenue |
| ACC-03 | Derived cash negative | Submit blocked |
| ACC-04 | Cash shortage ₹300 | Suspense ₹300; expenses unchanged until owner write-off |
| ACC-05 | Supplier bill ₹11,08,800 then payment | Cost counted once |
| ACC-06 | "Customer credit" chosen on receipt screen | Rejected |
| ACC-07 | Post-lock correction | Reversal + replacement; snapshot delta visible; original snapshot unchanged |
| IMP-01 | Same file uploaded twice | Second blocked by hash |
| IMP-02 | Duplicate name+phone inside file | Flagged in preview, not imported until resolved |
| IMP-03 | Customer already exists | Flagged DUPLICATE_EXISTING |
| IMP-04 | Typed total ≠ file total | Confirm blocked |
| IMP-05 | Confirmed import | One OPENING_BALANCE entry per customer; revenue unchanged |
| IMP-06 | Concurrent confirm clicks | One import |

## 4. Definition of done (every phase)
- All listed tests pass in CI script (`npm run test:all`) against a real Postgres.
- No float types in migrations; lint clean; type-check clean.
- Phase report written to `docs/reports/PHASE_n_REPORT.md`.
- Nothing is claimed complete unless implemented and tested.
