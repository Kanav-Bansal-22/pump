# Accounting & Operational Workflows — v2.0

Every rule here has an automated test listed in IMPLEMENTATION_ROADMAP §3.

## 1. The five things we never mix

| Concept | Meaning | Source of truth |
|---|---|---|
| **Fuel sales (revenue)** | Litres sold to customers × price | Meter segments only |
| **Settlement of sales** | *How* those sales were paid: cash / UPI / card / customer credit | Credit-sale slips + UPI/card declarations; cash is the balancing figure |
| **Collections** | Money received (sales cash, repayments, other receipts) | Cashbook (journal lines on cash/bank/clearing accounts) |
| **Receivables / payables** | What customers owe us / we owe suppliers | Journal lines with a party |
| **Expenses** | Costs of running the pump | Journal lines on expense accounts |

## 2. Chart of accounts (system accounts, seeded)

| Code | Account | Type | Allowed posting sources (guard) |
|---|---|---|---|
| 1100-x | Cash drawer *x* | Asset | receipts, payments, transfers, day post, cash difference |
| 1200-x | Bank *x* | Asset | transfers, settlements, bank receipts/payments |
| 1300 | UPI/Paytm clearing (per provider) | Asset | day post (UPI sales), UPI receipts, settlements |
| 1310 | Card clearing | Asset | day post, card receipts, settlements |
| 1400 | Customer receivables (party = customer) | Asset | CREDIT_SALE, CUSTOMER_REPAYMENT, OPENING_BALANCE, REVERSAL, corrections |
| 1600 | Cash over/short **suspense** | Asset/Liab | CASH_COUNT_DIFFERENCE, SUSPENSE_RESOLUTION |
| 1700 | Staff advances (party = employee) | Asset | STAFF_ADVANCE, SALARY_PAYMENT, SUSPENSE_RESOLUTION |
| 1900-s | Fuel sales control (station *s*) | Clearing | CREDIT_SALE, DAY_SALES_POST, SALES_DECLARATION (must be 0 after lock) |
| 2100 | Supplier payables (party = supplier) | Liability | SUPPLIER_BILL, SUPPLIER_PAYMENT, OPENING_BALANCE |
| 3100 | Opening balance equity | Equity | OPENING_BALANCE only |
| 3200 | Owner capital / drawings | Equity | OTHER_RECEIPT (capital in), payments (drawings) |
| 4100 / 4110 | Fuel sales: Petrol / Diesel | Income | **DAY_SALES_POST, SALES_RECLASS, POST_LOCK_CORRECTION only** |
| 4190 | Fuel sales: unconfirmed (override-locked provisional) | Income | DAY_SALES_POST, SALES_RECLASS |
| 4200 | Lube & other product sales | Income | OTHER_RECEIPT |
| 4300 | Other income | Income | OTHER_RECEIPT |
| 5100 | Fuel purchases (cost) | Expense (COGS) | SUPPLIER_BILL (fuel) |
| 6xxx | Operating expenses (salary, electricity, repairs, tea…) | Expense | EXPENSE_PAYMENT, SUPPLIER_BILL (non-fuel), SALARY_PAYMENT, SUSPENSE_RESOLUTION (write-off acct only) |
| 6900 | Bank/MDR charges | Expense | UPI_SETTLEMENT, CARD_SETTLEMENT |

The **guard** is a DB trigger. For example, the database rejects a `CUSTOMER_REPAYMENT` journal that touches 4100, and rejects a `SUPPLIER_PAYMENT` that touches any 6xxx account.

## 3. Meter workflows

### 3.1 Quantities

```
u            = reading + wrap_count × modulus            (cumulative value inside one epoch)
throughput   = u_end − u_start                            (0 across a reset/replacement bridge)
customer L   = throughput − tests_returned − tests_not_returned
depletion    = throughput − tests_returned               (= customer L + tests_not_returned)
stock loss   = tests_not_returned                         (report line; already inside depletion)
sales value  = ROUND(customer L × segment price, 2)       per segment, then summed
```

### 3.2 Normal entry (employee)
1. The nozzle card shows the last accepted reading (read-only), time and person. The employee **never types an opening**.
2. The employee types the current reading on a numeric keypad. A photo is optional unless a setting requires it.
3. The confirmation screen shows litres, tests, sales litres and ₹ value, so a typo stands out.
4. The server runs, in one transaction:
   - lock nozzle → idempotency check (H7) → stale check against the `prev_point_id` the form was loaded with (H4)
   - rules H1–H9 → insert point → flags F1–F14 → audit → NOTIFY
5. The result is shown as ✅ Accepted, 🟡 Sent for review (with plain-language reason), or ❌ Not saved (blocked attempts are logged in `meter_entry_attempts`).

### 3.3 Shifts
`SHIFT_END` of shift *n* is automatically the opening of shift *n+1*. Day end is the last shift's end, so there is no second number to type. Entering shift 2 before shift 1 is closed is blocked (H4).

### 3.4 Meter events (Correction A)

| | Rollover | Reset | Replacement |
|---|---|---|---|
| Physical meter | same | same, set back | new |
| Epoch | **unchanged** | +1 | +1 (new digits/serial row) |
| Points written on approval | one `ROLLOVER` point, `wrap_count + 1` | `EVENT_END` (old final) + `EVENT_START` (new start) | same as reset |
| Litres | `new + modulus − prev` (automatic via `u`) | `(old_final − prev) + 0 bridge + (next − new_start)` | same |
| Evidence | photo, reason, requester ≠ approver | same | same + old/new serial, new digit count |

Flow:
1. The employee enters a lower reading → H3 block. If the previous reading is within 1 % of the modulus, the screen suggests "Meter crossed maximum? Request rollover".
2. The employee requests the event with a photo and reason. Requests are allowed for employee, manager and owner.
3. The nozzle is blocked for new readings until the event is decided (D4h). The owner dashboard shows 🔁.
4. A **different** user with `meter.event.approve` approves, and the points are written atomically. Points carry `effective_at = observed_at`, the time the reading was actually seen.
5. Rejected → nothing is written to the chain; the request and decision stay visible.

Worked checks:
- TC-08 rollover: 9,999,900.00 → 150.00 at modulus 10,000,000.00 = **250.00 L**, epoch unchanged.
- TC-09 reset: 250 + 120 = **370.00 L**.
- TC-10 replacement: 300 + 200 = **500.00 L**.

### 3.5 Opening verification (Correction E)
- At the start of a day or shift (setting), the incoming person types the meter value **without seeing** the carried value.
- It is stored in `meter_verifications`, **not** in the chain, so it creates no segment and no litres.
- Match → ✓.
- Mismatch → F8 (REVIEW). The reviewer chooses one of:
  - **Verifier typo** → dismiss with reason.
  - **Previous closing was wrong** → standard correction (§3.8) of that closing point.
  - **Real gap** → inserts an approved `GAP_BOUNDARY` point (value = verified value, `effective_at` = verification time). The segment from the previous closing to the boundary is kind **GAP**, excluded from confirmed sales until attributed: SALE / TEST_RETURNED / TEST_NOT_RETURNED / METER_ERROR.
- TC-13: 2.00 L gap at ₹94, attributed SALE → ₹188.00 sales; if not collected it shows up as cash shortage.
- A lower verified value can never be inserted as a point (that would fail H3). It can only lead to a correction of the closing.

### 3.6 Flags and review
- Rules F1–F14 are as in v1.1, with D4f: F9 also covers "tests > throughput".
- Review options: accept, correct, reject, allocate days, attribute gap, dismiss typo, mark no-sale.
- An employee can never review their own entries. The owner can, marked *self-reviewed* and counted on the integrity panel.

### 3.7 Provisional continuation (Correction F)
- A flagged point does not stop the nozzle. The next entry chains from it.
- A segment is **confirmed** only if both its endpoints are ACCEPTED and it is not an unattributed GAP or unallocated MULTI_DAY segment.
- Screens show confirmed and provisional separately. Finalized revenue reports use confirmed only; provisional appears as a labelled separate line.
- The day cannot be submitted or locked with open REVIEW flags, missing day-ends or pending events, except by owner override with a reason.
- At an override lock, provisional value posts to **4190 Unconfirmed fuel sales**. When review later confirms it, a `SALES_RECLASS` entry moves it to 4100/4110. If review changes litres, a post-lock correction posts the difference, visible against the snapshot.

### 3.8 Corrections
- Never an edit. A correction is a replacement point with `supersedes_id`, the **original `effective_at`**, a reason and an approver.
- The value must stay strictly between its live neighbours (time and cumulative value), so litres only move between the two adjacent segments and the combined total over the span is unchanged (TC-21).
- If either day is locked, the correction is owner-only. A `POST_LOCK_CORRECTION` snapshot records the before/after.

### 3.9 Missing readings
- A job runs at day cut-over + grace and raises F7 for each active nozzle without a day-end.
- A later reading spanning several days creates a MULTI_DAY segment. It stays unattributed until a reviewer allocates litres per day (default equal split; must sum exactly).

## 4. Price change (Correction D)

### 4.1 Live procedure (preferred, no full station stop)
1. Owner/manager opens **Change price**: fuel, new price, reason. The session lists every active nozzle of that fuel and expires in 30 minutes. Normal readings on those nozzles are blocked while it is open.
2. **For each nozzle in turn:**
   - stop that nozzle
   - type its current reading (server stamps `captured_at`) and photograph it
   - change or confirm the new price on the dispenser
   - resume
   Each nozzle is paused only about a minute; other nozzles keep selling at the old price until their turn.
3. **Activate.** Only when every nozzle has a capture. One transaction writes:
   - one `PRICE_CHANGE` point per nozzle, `effective_at` = that nozzle's own `captured_at`
   - the `fuel_prices` row
   - the session as COMMITTED
   If anything is missing or fails, nothing is written (TC-23).
4. For each nozzle, litres before its own boundary get the old price and litres after get the new price. The price comes from the chain, not the clock, so fuel dispensed on nozzle B while nozzle A was being read is still correctly at the old price.
5. If the daily rate changes exactly at day cut-over (Q3), the DAY_END reading can serve as the boundary and no extra readings are needed.

### 4.2 If the dispenser price was changed but not recorded
- The owner opens a **retro split** (`RETRO_ESTIMATE`) with the reading seen at the time, the time, a photo or dispenser printout as evidence, and a reason.
- Points are inserted between neighbours and marked `is_estimate`.
- Locked days → post-lock correction with before/after snapshot.
- Nothing is silently rewritten. The report shows "Price split estimated by owner on …".

TC-05: 200 L × ₹94 + 295 L × ₹95 = ₹18,800 + ₹28,025 = **₹46,825.00**, depletion 495.00.

## 5. Testing fuel and stock (Correction B)

- Tests are recorded **when poured**: litres, returned yes/no, reason if not returned (DB CHECK).
- Example (TC-03): throughput 450.50, returned 5.00, not returned 2.00 →
  - customer 443.50 L = ₹41,689.00
  - depletion 445.50
  - stock loss 2.00
- Book stock: `close = open + invoiced deliveries − Σ depletion + Σ adjustments.quantity_effect`
- A `stock_adjustments` row linked to a test **must** have `quantity_effect = 0` (DB CHECK). It records only the owner's treatment of the loss. **INV-09** test: create a not-returned test plus its adjustment, and assert book stock falls by exactly 2.000 L, not 4.000 L.
- No journal entry for the stock loss value. Fuel purchases are already cost (5100), so expensing lost litres again would double-count. The loss appears as a quantity line, with a value at the latest purchase rate *for information only*.
- Dip variation = dip − book. It is shown daily and cumulatively and is never auto-adjusted.
- Tanker delivery: pre-dip → decant (tank's nozzles paused, D18) → post-dip. The measured quantity is compared with the invoiced quantity. Any `DELIVERY_SHORTAGE` adjustment must be approved.

## 6. Money workflows and their postings

| # | Event (screen) | Journal | Revenue? | Expense? |
|---|---|---|---|---|
| 1 | **Customer credit sale** (उधारी) | Dr 1400 (customer) / Cr 1900-s | No (settlement of meter sale) | No |
| 2 | **Customer repayment** | Dr cash/UPI/bank / Cr 1400 (customer) | **No** | No |
| 3 | **Other receipt**: lube sale | Dr cash/UPI / Cr 4200 | Yes (non-fuel) | No |
| 4 | Other receipt: other income / capital introduced | Cr 4300 / Cr 3200 | 4300 yes / 3200 no | No |
| 5 | **Expense payment** | Dr 6xxx / Cr cash/bank | No | **Yes** |
| 6 | Supplier bill (fuel) | Dr 5100 / Cr 2100 (supplier) | No | Cost when billed |
| 7 | Supplier bill (non-fuel) | Dr 6xxx / Cr 2100 | No | Yes, once |
| 8 | **Supplier payment** | Dr 2100 / Cr bank/cash | No | **No** (settles liability) |
| 9 | Bank deposit / withdrawal / drawer transfer | Dr bank / Cr cash (or reverse) | No | No |
| 10 | UPI/card bank settlement | Dr bank (net) + Dr 6900 (charges) / Cr 1300/1310 (gross) | **No** | Only the charges |
| 11 | Opening balances (import / cut-over) | Dr 1400 / Cr 3100, etc. | **No** | No |
| 12 | **Day sales post** (at lock) | Dr 1900-s / Cr 4100/4110 (confirmed) + 4190 (unconfirmed) | **Yes, the only fuel revenue** | No |
| 13 | **Sales settlement** (at lock) | Dr 1300 (UPI sales) + Dr 1310 (card sales) + Dr cash drawer (derived cash sales) / Cr 1900-s | No | No |
| 14 | Cash count difference (at lock) | Shortage: Dr 1600 / Cr cash · Excess: reverse | No | **No** (suspense) |
| 15 | Suspense resolution (owner) | Recovered from staff: Dr 1700 / Cr 1600 · Written off: Dr 6960 / Cr 1600 | No | Only on explicit write-off |
| 16 | Salary / staff advance | Dr 6xxx salary or Dr 1700 / Cr cash | No | Salary yes; advance no |
| 17 | Reversal (correction) | Exact mirror of original + `reverses_entry_id` | Mirrors | Mirrors |

After #12 and #13, account 1900-s for the station-day nets to exactly 0 (INV-13). Fuel revenue therefore equals meter value, and the settlement exactly explains it.

### 6.1 Sales split and derived cash (D10)
For each drawer (and shift, if per-shift):
```
UPI sales   = declared UPI total received − UPI receipts already posted (repayments, other receipts)
Card sales  = declared card total − card receipts already posted
Credit sales= Σ credit-sale slips
Cash sales  = Meter sales value − UPI sales − Card sales − Credit sales − Other-mode sales   (derived)
```
- Derived cash < 0 → submission blocked ("UPI/card/credit entered is more than meter sales — check").
- Credit slips: amount is required. Litres are optional; if entered, `amount ≈ litres × current rate` within ₹1, else warn.

## 7. Cash reconciliation (Part 10)

```
Expected closing cash (drawer, day)
  = Opening cash                      (= previous day's COUNTED cash after its lock)
  + Cash sales (derived)
  + Cash repayments + other cash receipts + bank withdrawals + transfers in
  − Cash payments − bank deposits − transfers out
Difference = Counted − Expected      (>0 excess, <0 shortage)
```
- The count screen has an optional denomination grid (₹500 × n …), and a witness is optional.
- A difference is **never** an expense automatically. It goes to suspense 1600 and appears on the dashboard until the owner resolves it (#15).
- Differences within ±₹10 (setting) are labelled "rounding" but still recorded.

## 8. Daily closing

1. **Close day** (drawer holder / manager): enter UPI & card totals, count cash → **Submit**.
2. Guards before **Lock** (owner or permitted manager):
   - every active nozzle has a DAY_END or is out of service
   - no open REVIEW flags or pending meter events / price sessions
   - derived cash ≥ 0
   - cash counted
   - an owner override bypasses the guards only with a typed reason, which is recorded
3. **Lock** (one transaction):
   - `business_days FOR UPDATE`
   - post #12, #13, #14
   - write `day_snapshots` (all tiles, per-nozzle figures, ledger digest, meter chain heads, integrity code)
   - set LOCKED
4. **Closing screen tiles (Part 12):**
   - Counts & totals: receipts, payments, fuel sales, cash/UPI/card/credit sales, repayments, new credit, expenses, supplier payments
   - Cash: expected, actual, difference
   - Open items: pending approvals, missing readings, provisional litres, stock variation

   Each tile opens its underlying rows, and **the rows must sum to the tile** (test).
5. After lock: owner-only post-lock corrections, shown on the day with a "Corrected after lock" badge and before/after values from the snapshot.

## 9. Customer (Udhari) workflows

- **Udhari page:** name, phone, address, opening balance, Σ credit purchases, Σ repayments, outstanding (positive = owes us, negative = advance), last transaction date. Search by name, phone or vehicle.
- **Statement:** date, description, debit, credit, running balance, closing outstanding. PDF download, print, and WhatsApp share via the phone's share sheet (needs HTTPS, D11). Fallback: a `wa.me` text summary.
- **Opening-balance import** (owner):
  1. Upload Excel/CSV (template provided).
  2. SHA-256 file hash is checked; a re-upload is blocked.
  3. Preview shows valid rows, rows duplicated within the file, and rows that match an existing customer (normalized name + phone).
  4. The owner types the **total** shown on the old register. It must equal the import total, or the mismatch is shown.
  5. Confirm: one transaction creates customers and one `OPENING_BALANCE` journal per customer (Dr 1400 / Cr 3100; advances are the reverse).
  6. The batch stays "not reconciled" until the owner ticks the register check.
  7. Opening balances never appear in sales or revenue reports (INV-04).

## 10. Supplier workflows

- **Bill entry:** supplier, bill no. (unique per supplier), date, due date, fuel or other category, attachment → posting #6 or #7.
- **Payment screen** asks first: *"Paying a supplier bill?"*
  - **Yes** → choose supplier and bill(s) → #8 (settles the bill, not an expense).
  - **No** → expense category → #5.
  This choice is what makes double counting impossible. A bill-linked payment cannot touch an expense account (guard).
- **Advance payments to an OMC** before a delivery → #8 with no bill. The supplier balance goes negative (advance) until the invoice arrives.
- Statements, outstanding and due dates are views over the journal.

## 11. Invariants (automated tests)

| ID | Invariant |
|---|---|
| INV-01 | Trial balance: Σ debits = Σ credits overall and per entry |
| INV-02 | Fuel revenue accounts only receive DAY_SALES_POST / SALES_RECLASS / POST_LOCK_CORRECTION |
| INV-03 | A customer repayment changes receivables and cash, with revenue unchanged |
| INV-04 | Opening-balance import changes receivables and equity only |
| INV-05 | Supplier payment changes payables and bank only; expenses unchanged |
| INV-06 | UPI settlement: revenue unchanged; only charges hit expenses |
| INV-07 | Internal transfers/deposits: P&L unchanged |
| INV-08 | Tests (returned and not returned) never appear in revenue |
| INV-09 | Test not returned + linked adjustment depletes stock exactly once |
| INV-10 | Σ six nozzle tiles (confirmed) = station DSR = consolidated DSR = 4100+4110 for locked days |
| INV-11 | Per epoch: Σ segment throughput = last u − first u (telescoping) |
| INV-12 | Σ customer sub-ledger = control account 1400; same for 2100 |
| INV-13 | Fuel sales control 1900-s = 0 for every locked station-day |
| INV-14 | Locked snapshot never changes; post-lock corrections produce a new snapshot with deltas |
