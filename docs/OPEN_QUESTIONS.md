# Open Questions — answers needed before Phase 2

## Answers received (2026-11-11)

| Q | Owner's answer | Design consequence |
|---|---|---|
| Q3c | Prices change **every day at 8 AM** | Rate entered daily. If the daily reading is taken at 8 AM, that reading is also the price boundary and no extra readings are needed. **Reading time still to confirm (Q3b).** |
| Q2 | Cash counted **once, at end of day**, as one total | One cash drawer for the whole site. No shift or attendant settlement. |
| Q3a | One reading per day (from register) | Shifts **off**. Each nozzle gets one DAY_END per day. Shift support stays in the design but is disabled. |
| Q4 | Photo shows 7 + 2 digit totalizers | `int_digits = 7`, `decimals = 2`, modulus 1,00,00,000. |
| Q5 | Testing: "don't know, can be done anytime" | Optional **Test pour** button, never mandatory. If unused, tests = 0. |
| Q7 | Old credit register is known; owner will provide it later | Opening-balance import is built; the data comes later. |
| Q8 | **No separate manager portal; same screens for every employee** | Two roles: **Owner** and **Staff**. Individual logins are still kept (assumed, see A1). |
| Q9a | Lubricants are sold | "Other sales" receipt, revenue separate from fuel. No lube stock in v1. |
| Q9c | No GST | No GST fields or invoices. |
| Q10a | Windows laptop, 8 GB RAM | Enough for native PostgreSQL + Node. Confirms D1 (no Docker in production). |
| Q10c | **No external USB drive, no UPS** | See FINAL_ARCHITECTURE §7: backups to the laptop + owner's phone + printed code. Honest risk stated. |
| Q10d | Go-live **around 15 Nov 2026** | See IMPLEMENTATION_ROADMAP §0 (staged go-live). |
| Q11 | Cashbook photo provided; left = udhari given, right = sales + udhari received; "the inputs in the photo are everything" | `CASHBOOK_MAPPING.md`. The app's daily inputs are limited to that list. |

### Still open after these answers
- **Q3b** At what time is the daily reading written: 8 AM (with the price change) or at night?
- **Scope:** your original requirements included **UPI/card split, tank dips & stock, supplier (HPCL) ledger, meter photos and opening verification**, none of which appear in the register. Keep each in v1, or postpone? Until you answer, they are **postponed, not deleted**: the database supports them and they can be switched on later.
- ~~Go-live~~ **Answered:** staged go-live around 15 Nov, paper register kept in parallel (owner, 2026-11-11).
- **A1** "Same for every employee" is read as *same screens* with **individual logins**. Do you instead mean one shared login? Not recommended: you could no longer see who entered what.
- **A2** Approvals: with only Owner + Staff, the owner approves staff requests (meter reset/replacement, corrections). For the owner's **own** requests there is no second person. Proposed: allowed, but photo required and marked "self-approved" on the integrity panel.
- **R1–R4** in `CASHBOOK_MAPPING.md §5`: the "62/Rech" line, "Jagjeet loan", "Return 1,53,596", and whether UPI money is inside the cash figure.

---

## Original question list

These are the only business facts the design cannot decide by itself. Each one changes configuration or workflow. Where a design *proposal* exists it is marked "Proposed"; it is **not** assumed until you confirm.

## Essential (blocking)

**Q1. Site layout.**
- (a) Are the three "stations" dispensing units at **one** outlet (same compound, same Wi-Fi), or three separate locations? The single-laptop LAN design only works at one location.
- (b) How many underground tanks are there, of which fuel, and which nozzles draw from which tank? (For example: do both diesel stations share one diesel tank?)

**Q2. Cash handling.**
Who holds cash during the day? Choose one:
- (i) each nozzle attendant keeps cash and settles with the manager at shift end
- (ii) one cash counter per station
- (iii) one cash counter for the whole outlet

Also: is there a fixed opening float, and how often is cash deposited to the bank, and by whom?

Proposed: model this as configurable "cash drawers"; your answer sets the default.

**Q3. Shifts, business day and price changes.**
- (a) How many shifts, with what timings?
- (b) When does the business day end (midnight, 6 AM, last shift close)?
- (c) How do selling prices change: set by the oil company, pushed to the dispensers automatically (at what time?), or changed by hand on the dispenser? How often does it actually happen?

**Q4. Meter display.**
- How many digits before and after the decimal point does each dispenser's **cumulative totalizer** show? A photo of each of the six displays is ideal.
- Are they electronic totalizers that keep their value through power cuts?

The template spreadsheet's sample values (e.g. 1,820,635.20) suggest 7 + 2. Please confirm on the real dispensers.

**Q5. Testing fuel and tanker deliveries.**
- How often are tests done, and how much (5-litre measure)? Is the fuel normally poured back?
- During tanker decantation, do you stop selling from that tank between the before-dip and after-dip?
- Do you have the tank calibration (dip) charts?

**Q6. Payment channels.**
- Which UPI/QR providers do you use (Paytm soundbox, PhonePe, bank QR…) and which card machine?
- Can staff see a day/shift **total** on each device? (Decision D10 relies on declaring totals.)
- Which bank accounts receive settlements?

**Q7. Credit customers.**
- Roughly how many credit customers, and is the old register total known?
- Should there be credit limits: warn only, or block?
- Should employees see a customer's outstanding balance when recording a credit sale?
- Do any customers need a printed bill/challan per fill (vehicle number, litres)?

**Q8. People and approvals.**
- Who will be Manager(s)?
- Who should approve meter events and corrections when the owner is the one requesting? Events require a second person, even for the owner.
- Can the owner approve from his phone during the day?

**Q9. Scope confirmations.**
- (a) Do you sell lubricants or other items? Proposed: "Other sales" receipts, counted as revenue separately from fuel.
- (b) Employee module: only staff records + salary/advance payments, or also attendance?
- (c) Are GST invoices needed for anything in v1? Fuel itself is outside GST; lubricants are not.

**Q10. Hardware and go-live.**
- (a) Is **this** laptop (Windows 11 Home) the one that will run the server? What are its RAM and disk?
- (b) Can you log in to the Wi-Fi router to reserve an IP?
- (c) Do you have, or can you buy, a UPS and two external USB drives?
- (d) What go-live date do you want for the opening balances (cash, bank, tank dips, meter baselines, customer and supplier balances)?

**Q11. The handwritten cashbook.**
- Please share a photo of one or two pages of the current Rokad/cashbook (blur names if you wish). v1.0 asked for this and never received it.
- The receipt/payment screens will copy its column order and wording so the switch feels familiar.

## Decisions for you to approve (from FINAL_ARCHITECTURE §3)

| # | Decision | Your choice |
|---|---|---|
| D1 | Native Windows services instead of Docker for the live server | ☐ approve |
| D3 | Internal double-entry journal (invisible to employees) | ☐ approve |
| D4c | Blind opening verification, outside the reading chain | ☐ approve ☐ verification off |
| D4d | Per-nozzle price-change procedure (one nozzle paused at a time) | ☐ approve |
| D4e/F | Provisional continuation (not blocking the nozzle) | ☐ approve (your stated preference) |
| D7 | Weekly drive rotation + printed integrity code | ☐ approve |
| D11 | HTTPS with one-time certificate install on each phone | ☐ approve |
| D16 | Cash "rounding" label within ±₹10 | ☐ approve, amount: ₹___ |

## Not blocking (sensible defaults, change any time in Settings)
- Flag thresholds: 3× / 25 % of 14-day median, 20 L tests per nozzle per day, 2 L not-returned per day, 0.5 % stock variation.
- Session lengths: employees 12 h, owner devices 7 days.
- Backups: hourly 07:00–23:00, nightly 02:00.
