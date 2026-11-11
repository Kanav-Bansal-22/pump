# Final Architecture: Petrol Pump Management & Accounting System (v2.0)

Status: **Phase 1 deliverable, awaiting owner approval. No application code written.**
Date: 2026-11-11

## 0. Sources and precedence

| Priority | Source | Notes |
|---|---|---|
| 1 | Master Project Prompt (Parts 1–20) | Highest authority. Mandatory corrections A–G (Part 17). |
| 2 | `PETROL_PUMP_ARCHITECTURE_ADDENDUM_v1.1_METERS.txt` | Supersedes v1.0 §2.2, §3.2 steps 1/2/8, L5, L6, L17. |
| 3 | `PETROL_PUMP_ARCHITECTURE.txt` (v1.0) | Everything not superseded stands **unless changed in §3 below**. |
| ref | `Downloads/Petrol_Pump_Accounts_v2.xlsx` (and two earlier workbooks) | Template workbooks. Every data row says "EXAMPLE ROW – delete me", so they hold **no real business data**. Used only as hints: 7-digit meter values, "Rokad" cashbook, lube sales column. |

Companion documents (all in `docs/`):
`DATABASE_SCHEMA.md` · `ACCOUNTING_WORKFLOWS.md` · `SECURITY_AND_BACKUP_PLAN.md` · `IMPLEMENTATION_ROADMAP.md` · `OPEN_QUESTIONS.md` · `REQUIREMENTS_TRACEABILITY.md`

Phase 0 findings:
- **Repository:** `Desktop/PUMP` contained only the two architecture text files. There is no existing code, database or dependency to preserve.
- **Git:** the parent folder `C:\Users\lenovo` is itself a git repository (with an ownership warning). Phase 2 will create a **separate** repository inside `PUMP`.

---

## 1. System overview

```
 Employee / owner phones (Chrome, installed as PWA)        Owner laptop browser
          │  HTTPS over shop Wi-Fi (LAN only)                      │
          ▼                                                        ▼
 ┌──────────────────────── Server laptop (Windows, reserved IP e.g. 192.168.1.100) ────────────────┐
 │ Caddy (Windows service) :443  ── TLS with its own local CA, cert issued for the IP address      │
 │   └─► Next.js app (Node LTS, Windows service) :3000 (bound to 127.0.0.1 only)                    │
 │         • UI pages (React, Tailwind) – mobile-first                                              │
 │         • Route handlers /api/*  – ALL validation, posting and money logic                       │
 │         • Posting engine (double-entry journal), meter engine, stock engine, closing engine       │
 │         • SSE /api/live  ◄── PostgreSQL LISTEN/NOTIFY                                            │
 │ PostgreSQL 16 (Windows service, listen_addresses = localhost)                                    │
 │         • roles: pump_owner (DDL) / pump_app (DML, restricted) / pump_backup (read)             │
 │         • triggers: immutability, hash chain, seq, lock guard, posting-rule guard, audit          │
 │ data/uploads (photos, import files)  ·  backups/ (hourly + nightly) ──► external USB drive(s)     │
 │ Scheduled tasks: backup, integrity verification, missing-reading job, restore test, health check   │
 └───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Principles:
1. **One process, one database, one source of truth.** No per-device databases and no sync.
2. **The server decides.** Business date, timestamps, opening readings, prices and posting rules are all decided on the server. The client is never trusted for these.
3. **Append-only facts.** Corrections are new rows. Workflow state lives in separate decision tables or in tightly guarded state-machine columns (§3, D5).
4. **The database enforces the invariants** (constraints, triggers, grants). Application code is the first check, not the only one.
5. **No offline write queue.** A failed save is shown clearly as **not saved** and the form keeps its values.

### 1.1 Technology stack (final)

| Layer | Choice | Reason / change vs v1.0 |
|---|---|---|
| App | Next.js (current stable major at Phase 2, App Router) + TypeScript strict | v1.0 named Next.js 14. Pin whatever is current and stable in Phase 2. |
| Runtime | Node.js current LTS (pinned) | — |
| DB | PostgreSQL 16 | As requested. Supported until Nov 2028; upgrade path documented. |
| DB access | Prisma (typed CRUD) + raw SQL migrations (triggers, views, grants) + `$queryRaw` inside transactions for `FOR UPDATE` locking | Prisma cannot express triggers or partial indexes. Those go in SQL migrations. |
| Decimal | `Prisma.Decimal` / decimal.js end-to-end. ESLint rule bans `Number()`/`parseFloat` in money modules | Never float. |
| Validation | Zod on every endpoint | — |
| PDF | pdfmake (server-side) | Free, deterministic. |
| Excel | ExcelJS (read + write) | — |
| Live updates | SSE + Postgres NOTIFY | As v1.0. |
| Tests | Vitest (unit) + integration tests against a real throwaway Postgres DB + Playwright (key mobile flows) | Concurrency tests use parallel DB connections. |
| HTTPS | Caddy with its built-in local CA, certificate for the **IP address** | Android Chrome resolves `.local` names unreliably. |
| Deployment | **Native Windows services** (PostgreSQL, app via WinSW/NSSM, Caddy). Docker Compose only for development | See decision D1. |

---

## 2. Site model (configurable, pending OPEN_QUESTIONS Q1)

The master prompt says "3 stations, 2 nozzles each" **and** "all devices on the same local Wi-Fi". Both can only be true if the three stations are **dispensing units at one physical outlet**. If they are at different locations, a single LAN model will not work. That question is blocking (Q1).

The schema is built so either answer fits without redesign:

```
Business ─ Site (outlet, one LAN) ─┬─ Station (dispensing unit / island) ── Nozzle (2 each)
                                   ├─ Tank (fuel type; nozzles map to a tank, tanks may serve several stations)
                                   └─ Cash drawer(s) (per station, per site, or per attendant-shift: configurable)
```

- Tanks belong to the **site**, not the station. Two diesel stations probably share diesel tank(s), and v1.0 wrongly placed `station_id` on tanks.
- **Cash drawers** are configurable so reconciliation can follow how cash is really handled (Q2).
- Prices are per **site + fuel type**. Per-station prices are possible but not expected.

---

## 3. Review findings and decisions

Each item gives the current design, the problem, the change, its effect on the workflow, and its cost or complexity.

### 3.1 Contradictions between v1.0, v1.1 and the master prompt

| # | Topic | v1.0 | v1.1 | Master prompt | Resolution |
|---|---|---|---|---|---|
| C1 | Testing fuel | All returned; `net = closing − opening − testing` | Three quantities | Three quantities (Part 5) | v1.1/master. |
| C2 | Rollover | Event type, epoch implied | Diagram and §3.4 route rollover through EVENT_END/EVENT_START and "increments meter_epoch" | Rollover keeps the **same** epoch, uses modulus (Part 17-A) | **D4b**: rollover = same epoch, `wrap_count + 1`, no bridge. |
| C3 | Opening verification | — | `OPENING_VERIFY` is a chain point | Must not create a sales segment (17-E) | **D4c**: verification moved out of the chain into its own table. |
| C4 | Stock loss | — | `tank_adjustments` auto-records tests not returned **and** the book formula subtracts depletion that already includes them | Must not double-deduct (17-B) | **D6**: adjustments carry `quantity_effect`; test-linked rows forced to 0 by CHECK. |
| C5 | Chain-head storage | — | `backup_log` (same DB) + inside backups | Must be independent (17-C) | **D7**: external append-only manifest + offline rotated drive + printed integrity code. |
| C6 | Price change | Effective date per day; "split reading" | One global `effective_at = now()` at submit | No interval assigned to wrong price (17-D) | **D4d**: per-nozzle boundary times; price is taken from the chain, not the clock. |
| C7 | Phase plan | 8 phases | Meter schema in Phase 2 | 6 phases, meters in Phase 3 | Master's 6 phases. Meter tables are created in Phase 3 migrations. |
| C8 | Employee module | Salary, attendance, advances | — | "Employee entries" only; not in Part 4 module list | v1 keeps **employee master + salary/advance payments**. Attendance only if Q9 says so. |
| C9 | Lubricant sales | "+ lubricant sales entries" | — | Not mentioned | Kept as "Other sales" receipts (revenue, separate from fuel). Confirm in Q9. |
| C10 | Credit limit | Advisory lock, implied block | — | Not mentioned | Optional per-customer limit, **warning only** by default (Q7). |
| C11 | Self-review | — | Owner may self-review (marked) | Requester must not approve own request | Meter **events**: never self-approved, not even by the owner. Flag **reviews**: owner self-review allowed, marked, shown on the integrity panel. Q8 confirms who approves when the owner is the requester. |
| C12 | "Customer credit" mode | Payment mode list | — | Listed among receipt and payment modes (Part 9) | "Customer credit" is valid **only as a sales-settlement mode** (credit sale). It is rejected on receipt and payment screens, because those modes move money. |
| C13 | Cash formula (Part 10) | Opening + receipts − payments − deposits + withdrawals | — | Signs lost in formatting | v1.0 formula confirmed (ACCOUNTING_WORKFLOWS §7). |
| C14 | Docker vs native | Docker preferred | — | Docker "if practical" | **D1**: native services on Windows. |
| C15 | Tests > throughput (H9) | — | Hard block on the closing reading | — | **D4f**: block bad test entries at entry time. At closing, flag instead of blocking a true meter reading. |

### 3.2 Mandatory corrections (Part 17) — how each is met

| ID | Correction | Where specified | Proven by |
|---|---|---|---|
| A | Rollover ≠ reset/replacement | D4b; SCHEMA `meter_epochs`, `meter_points.wrap_count`; WORKFLOWS §3.4 | TC-08, TC-08b/c, TC-09, TC-10, TC-33 |
| B | No stock-loss double count | D6; SCHEMA `stock_adjustments` CHECK; WORKFLOWS §5 | TC-04, **INV-09** |
| C | Independent hash-chain verification | D7; SECURITY §4 | TC-22, TC-31, TC-34, TC-35 |
| D | Controlled price change | D4d; WORKFLOWS §4 | TC-05, TC-23, TC-36–38 |
| E | Opening verification ≠ sales segment | D4c; WORKFLOWS §3.5 | TC-13 (rewritten), TC-39 |
| F | Provisional continuation | D4e; WORKFLOWS §3.7 | TC-14, TC-20, TC-24, TC-40 |
| G | Accounting consistency | D3 (double-entry journal + posting-rule guard) | INV-01…INV-14 |

### 3.3 Design decisions (changes to v1.0/v1.1)

**D1. Native Windows services instead of Docker Compose for production**
- *Current:* Docker Compose with restart policy.
- *Problem:* On Windows, Docker Desktop needs WSL2 and ~2 GB RAM, and it **only starts after a user logs in**. After a power cut or Windows Update reboot, the app stays down until someone logs in. That breaks "start automatically after reboot".
- *Change:* PostgreSQL's Windows installer registers a service that starts at boot. The Node app and Caddy also run as Windows services (WinSW or NSSM) with automatic restart. Docker stays available for development only.
- *Workflow effect:* none for users. The app comes back by itself after reboots.
- *Cost:* zero. A slightly longer install script (written and documented in Phase 6).

**D2. Configurable site / station / tank / cash-drawer model** (§2). *Cost:* a few extra config tables. Avoids a redesign whichever way Q1 and Q2 are answered.

**D3. Internal double-entry journal as the single posting model**
- *Current (v1.0):* Separate `receipts`, `payments`, `customer_ledger`, `supplier_ledger` tables, with a `posting_class` column to keep repayments out of revenue.
- *Problem:* `posting_class` relies on the right class being chosen and every report filtering on it. A missed filter double-counts. Customer, supplier and cash ledgers are separate stores that can drift apart. Nothing in the database proves sales = settlement.
- *Change:* Every business event (credit sale, repayment, expense, supplier bill, deposit, day close…) is posted by one **posting engine** as a balanced journal (Σ debit = Σ credit, checked by a deferred trigger) against a small fixed chart of accounts. Each account has an `allowed_sources` list, enforced by trigger. Fuel-revenue accounts accept postings **only** from `DAY_SALES_POST` or its correction types. Expense accounts **reject** `SUPPLIER_PAYMENT`, `CUSTOMER_REPAYMENT`, `INTERNAL_TRANSFER`, `UPI_SETTLEMENT` and `OPENING_BALANCE`. Customer and supplier ledgers, the cashbook and P&L become **views over the journal**, so they cannot disagree.
- *Workflow effect:* **none visible.** Employees still see "Receipt", "Payment", "Udhari", like the handwritten Rokad. The journal is internal. The owner never needs to see debit/credit unless they want to.
- *Cost:* more design work in Phase 2/4. In return, every Part 17-G rule is enforced by the database and becomes a one-line automated test.

**D4. Meter-chain corrections**

- **D4a. Two orderings.** v1.1 derived segments with `LAG` over `seq` (insertion order). Correction points (`supersedes_id`), retro price splits and gap boundaries are appended later but belong **earlier** in time, so a seq-ordered `LAG` produces wrong segments.
  - *Change:* `seq` is the **log order**, used only by the hash chain. Segments are computed over **live points ordered by (`effective_at`, `seq`)**.
  - A retro point must fit strictly between its live neighbours in both time and cumulative value.
- **D4b. Rollover (Correction A).** Rollover is a point of type `ROLLOVER`.
  - The epoch stays the same and `wrap_count` increases by 1.
  - Cumulative value `u = reading + wrap_count × modulus`, so throughput is always `u_end − u_start` within an epoch, which gives the modulus formula automatically.
  - It is not a bridge and has no zero-litre segment. Rollover still needs an approved `meter_event` with photo (Part 4.2 "all events require…").
  - Reset/replacement creates `EVENT_END` (old meter, old epoch), then a zero-litre bridge, then `EVENT_START` (new epoch, `wrap_count = 0`). Each epoch has its own row in `meter_epochs` (digits, decimals, modulus, serial), because a replacement meter may have a **different digit count**. v1.1 stored digits on the nozzle, which would have broken rollover maths after a replacement.
- **D4c. Opening verification (Correction E).** v1.1 made `OPENING_VERIFY` a chain point. A typo in a verification would then become the "previous reading", and a *lower* verify value would be hard-blocked by H3 even though it is exactly the evidence of an overstated closing.
  - *Change:* verifications go to `meter_verifications`, outside the chain.
  - The verifier types the value **blind**: the carried reading is not shown, so a "yes it matches" tap is impossible.
  - Match → recorded. Mismatch → F8 flag with three review outcomes: *verifier typo* (dismiss); *previous closing wrong* (standard correction); *genuine gap* (reviewer inserts an approved `GAP_BOUNDARY` point at the verification time, and the gap segment is then attributed). Throughput is never duplicated because segments always telescope between live points.
- **D4d. Price change (Correction D).** A single global `effective_at` misprices fuel dispensed while readings were being collected. The dispenser, not our server, decides what the customer paid.
  - *Change:* a **price-change session**. For each nozzle in turn: stop that nozzle, read it, change or confirm the dispenser price, record the reading (server captures the time), resume.
  - On commit, one transaction inserts all boundary points (each with its **own** `effective_at`), the event and the new price. If any nozzle is missing, nothing is written.
  - Segment price comes from **the latest price boundary in that nozzle's own chain**, not from the clock.
  - Normal entries on those nozzles are blocked while the session is open (max 30 min). Only one nozzle pauses at a time, about a minute each, so the station does not need a full stop.
- **D4e. Provisional rule (Correction F).** v1.1 said a segment is confirmed only if "every earlier point" is accepted. A segment depends only on **its two endpoints**, so v1.1's rule would make everything after one flag provisional for ever.
  - *Change:* confirmed ⇔ both endpoints ACCEPTED, and the segment is not GAP or MULTI_DAY unallocated. Otherwise as v1.1 and master.
- **D4f. Test entries (H9).** A wrong test entry (50 instead of 5) would hard-block the employee's true closing reading. *Change:*
  - A test entry above a sane maximum (default 20 L per pour) is blocked at entry time.
  - At reading time, tests greater than throughput **flag** the segment (F9) instead of blocking.
  - Wrong tests are fixed by a void row, never by editing.
- **D4g. One shift/day boundary.** Partial unique index: at most one original `SHIFT_END` or `DAY_END` per nozzle per business date per shift. Corrections carry `supersedes_id` and are exempt. This prevents two employees creating two "day-ends".
- **D4h. Rollover/event pending.** While a meter event is REQUESTED on a nozzle, new readings on that nozzle are **blocked**. Any further reading would also be below the pre-rollover value, so it would be blocked anyway. Approval normally takes minutes, and the day cannot close until it is resolved.

**D5. Immutable facts vs workflow state**
- *Problem:* v1.0/v1.1 declare tables append-only but then need UPDATEs (`meter_events.status`, `nozzle_tests.voided_by_id`, `price_change_events.approved_by`, `receipts.voided_by_id`, `cash_days.status`, `import_batches.status`).
- *Change:*
  - **Fact tables** (meter points, tests, journals, source documents) never allow UPDATE or DELETE.
  - Voids and approvals are separate append-only rows (`nozzle_test_voids`, `meter_event_decisions`…).
  - **Workflow tables** (`business_days`, `meter_events`, `price_change_sessions`, `import_batches`) allow UPDATE only on a status column, only along allowed transitions, enforced by a state-machine trigger, with every change written to `audit_log`.

**D6. Stock adjustments (Correction B).** `stock_adjustments.quantity_effect` is the only adjustment term in the book-stock formula. Any row linked to a `nozzle_test` must have `quantity_effect = 0` (CHECK); it carries owner treatment only (investigate/recover/accept).
- Under the periodic purchase method (fuel purchases are cost when billed), "writing off" lost test fuel as an expense would **also** double-count cost, so it is not allowed. The loss shows in quantity reports and lowers gross profit naturally.

**D7. Independent integrity anchors (Correction C).** See SECURITY_AND_BACKUP_PLAN §4.
- Chain heads and daily ledger digests go to an append-only `manifest.jsonl` on the external drive, plus a **second drive rotated weekly and kept at home**.
- An 8-character **integrity code** is printed on each locked daily-closing report, which the owner files on paper. Paper and an offline drive cannot be rewritten from the laptop.

**D8. Business-day row locks.** v1.0's "trigger blocks inserts into locked days" can race with the lock itself.
- *Change:* a `business_days` row per (station, date).
- Every posting takes `FOR SHARE` on it. Locking takes `FOR UPDATE`, so a lock waits for in-flight entries and no entry can slip in after the snapshot.

**D9. Idempotency with stored responses.** `idempotency_keys(key, user, endpoint, request_hash, response, created_at)`.
- Same key + same body → original response (H7).
- Same key + different body → rejected (catches client bugs).

**D10. UPI/card declarations.** Phones and soundboxes show **total** UPI received, which includes UPI udhari repayments and UPI "other receipts".
- *Change:* staff declare the **total** UPI (and card) received per drawer/shift. The system subtracts UPI receipts already posted as repayments or other income to get UPI **sales**.
- Without this, a ₹5,000 UPI repayment would be counted once as repayment and again inside "UPI sales".

**D11. HTTPS from day one.** WhatsApp sharing of a statement **PDF file** uses the Web Share API, which works **only in a secure context**. So do PWA install and camera APIs.
- Caddy's local CA, installed once per phone (5-minute guide, Phase 6). Phase 2 can start on HTTP inside the LAN for development.

**D12. Hourly backups during business hours** (DB is small, seconds per dump) in addition to the nightly full backup, so a disk failure loses at most an hour.

**D13. Server-derived business date** from server clock (Asia/Kolkata) and the configured day cut-over time (Q3). Phones never send a date for new entries.

**D14. Demo and real data separated.** Separate databases `pump_demo` and `pump_prod`. The demo UI shows a permanent orange "DEMO DATA" banner. Demo seed data is generated, never presented as real (Rule 9).

**D15. Go-live cut-over** (missing from v1.0/v1.1). One documented cut-over moment sets, in a single owner-confirmed batch:
- meter BASELINE points (with photos)
- tank opening dips
- opening cash per drawer and bank balances
- customer and supplier opening balances (imported)

All opening balances post against *Opening Balance Equity*, never revenue or expense.

**D16. Cash rounding tolerance.** Dispensers round each transaction, so Σ(transactions) ≠ litres × price by a few paise to rupees a day. Cash differences within a configurable tolerance (default ±₹10) are labelled "rounding" but are **still recorded**, never auto-cleared.

**D17. PIN login is device-bound.** A PIN works only on a phone previously signed in with the full password (device token cookie). 5 wrong PINs → full password required. The owner can revoke devices.

**D18. Tanker decantation.** Recommended procedure: pause the nozzles fed by that tank between the pre-dip and post-dip readings. Measured receipt = post-dip − pre-dip.
- Book stock uses the **invoiced** quantity. Any short receipt appears on the delivery record.
- The owner can post a `DELIVERY_SHORTAGE` stock adjustment (a real quantity effect) after investigation. Confirm the procedure in Q5.

---

## 4. Module map

| Module (`src/server/...`) | Responsibility | Phase |
|---|---|---|
| `auth` | users, sessions, PIN devices, RBAC, station scoping | 2 |
| `config` | site, stations, nozzles, tanks, fuel types, prices (read), payment modes, categories, drawers, settings | 2 |
| `audit` | audit trigger context, audit queries | 2 |
| `ops` | backups, health, integrity verification, manifest writer | 2 / 6 |
| `meters` | chain, entry rules H1–H9, flags F1–F14, verification, events, corrections, review queue | 3 |
| `pricing` | price-change sessions, retro splits | 3 |
| `tests` (testing fuel) | test pours, voids | 3 |
| `stock` | tanks, dips, deliveries, calibration, book stock, adjustments | 3 |
| `ledger` | chart of accounts, posting engine, journal, guards | 2 (core) / 4 |
| `sales` | sales split declarations, credit sales | 4 |
| `cash` | receipts, payments, transfers, cashbook, cash counts, reconciliation | 4 |
| `parties` | customers, suppliers, bills, import, statements | 4 |
| `closing` | business days, closing tiles, guards, lock, snapshots, post-lock corrections | 5 |
| `reports` | 22 reports, PDF/Excel/print | 5 |
| `events` | NOTIFY → SSE fan-out | 2 |
| `future` | `payment_events`, `integrations` tables only (no logic) | 2 |

## 5. User interface structure

**Employee home** (6 large buttons, Hindi + English, e.g. "Meter Reading / मीटर रीडिंग"):
1. Enter nozzle reading (also the "Test pour" button)
2. Record receipt
3. Record payment
4. Customer credit (उधारी)
5. Customer repayment
6. My entries (status: Saved ✓ / Under review 🟡 / Rejected ✗)

The **Daily close (cash count)** button appears only for users holding a cash drawer.

**Owner dashboard:** today's tiles (sales vs collections clearly separated), six-nozzle grid, cash in hand, outstanding, stock, pending approvals, integrity panel, backup and DB health.

**Every save screen** shows one of three unambiguous states:
- ✅ **Saved** (server confirmed, with entry number)
- ❌ **NOT saved** (with reason and a Retry button; form values kept)
- ⏳ Saving… (button disabled, so no double tap)

---

## 7. Changes from the owner's answers (v2.1, 2026-11-11)

| Area | Before | Now |
|---|---|---|
| Roles | Owner / Manager / Employee | **Owner / Staff.** Staff all see the same simple screens. Manager permissions stay in the schema, unused. |
| Shifts | Optional | **Off**: one DAY_END per nozzle per day |
| Cash | Configurable drawers | **One drawer for the site**, counted once a day |
| Daily inputs | Many screens | Only the register's inputs (CASHBOOK_MAPPING §4); everything else computed |
| Price | Per-nozzle price-change session | Daily rate change at 8 AM. If the daily reading is taken at 8 AM, the DAY_END reading is the price boundary and the session workflow is used only for unusual mid-day changes |
| Meter | Digits unknown | 7 + 2 digits (from register photo) |
| Postponed (not deleted) pending owner choice | UPI/card split, tank dips & stock, HPCL ledger, photos, blind opening verification | Built later behind settings. **Effect of postponing the UPI/card split:** cash expected = fuel sales − udhari given + udhari received − payments, as in the register. Any UPI money then shows up as a "difference" unless it is recorded as a payment line (R4). |
| Approvals | Requester ≠ approver always | Owner approves staff requests. Owner's own meter events: self-approval allowed only with photo, marked "self-approved" (A2, to confirm) |
| Backups | Two rotated USB drives | **No USB drive:** nightly backup kept on the laptop **and** downloaded to the owner's phone from the dashboard (DB is a few MB). The printed integrity code stays the independent paper anchor. |
| Power | UPS recommended | **No UPS:** laptop battery covers the laptop, but **during a power cut the Wi-Fi router goes off and phones cannot reach the app**. Entries during an outage go on paper and are entered afterwards (flagged as late entries). |

**Risks the owner should know (no USB, no UPS):**
1. If the laptop's disk fails or the laptop is stolen, the only copies are the ones on the owner's phone. If the owner forgets to download them, **data since the last download is lost**. The dashboard will nag daily.
2. A pen drive (~₹500) and a small router UPS (~₹1,500) are **one-time** costs, not monthly. They are still recommended but not required.

## 7a. Implementation decisions (Phase 2)

- **D19. Plain SQL migrations with the `pg` driver instead of Prisma.** The core rules live in SQL: triggers, roles and grants, row locks, journal guards and hash chains. Prisma cannot express these, which would mean keeping two schemas in step.
  - `pg` returns NUMERIC as exact strings, and arithmetic uses decimal.js, so money is never a float.
  - Migrations are append-only files with recorded SHA-256 checksums. The runner refuses an edited migration.
- **D20. Business day is per site, not per station.** The owner counts cash once a day for the whole pump, so `business_days` is keyed by (site, date). Station-wise figures still come from nozzle data.
- **D21. Source-type names.**
  - The sales-split posting is called `SALES_SETTLEMENT`.
  - Added: `LOAN_RECEIVED`/`LOAN_REPAYMENT` (account 2200, for lines like "Jagjeet loan" if confirmed) and `OWNER_CAPITAL`/`OWNER_DRAWING` (account 3200).
- **D22. Test database.** Tests run on a private, throwaway PostgreSQL 16.15 (`embedded-postgres`, dev-only) with the same restricted roles as production. Tests never touch real data.
- **D23. Stack versions pinned at Phase 2:** Next.js 16.4.6, React 19.3, Node 22, PostgreSQL 16.

## 8. Honest limitations

1. The laptop down, router down or Wi-Fi out ⇒ **nobody can enter data**. Paper fallback sheet + back-entry through the late-entry workflow (flagged F11).
2. No offline entry in v1.
3. A plausible false reading entered consistently across all independent checks can pass. The system makes manipulation **difficult, visible and traceable**, not impossible.
4. Anyone with Windows administrator rights on the server laptop and the Postgres superuser password can, in principle, rewrite the live database. Detection then depends on the independent anchors (offline drive, printed codes).
5. Book stock accuracy is limited by the tank calibration chart and temperature (no temperature compensation in v1).
6. UPI notification matching, bank import, automatic meter capture and WhatsApp automation are **future only**.
