# Owner guide · मालिक गाइड

On the laptop open `http://localhost` (or the pump address on your phone). Top bar: **Register · Daily records · Udhari customers · Settings**.

## Every day
1. **Register page:** watch the day as it happens. It refreshes by itself (⟳ time at the top).
   - **Day summary:** fuel sales − udhari given + udhari received − paid = cash that should be in hand. After counting: **Short / Excess**.
   - **Day book:** every entry with who entered it. Wrong entry → **cancel** (write the reason) → it stays visible, crossed out.
2. **End day (8 AM):** if a reading is missing or flagged, staff cannot end the day. You can, after writing the reason (it is saved and shown with ⚠ in Daily records).
3. **Settings → Backups → Download** the latest backup to your phone. This is the only copy away from the laptop.

## Daily records
One line per ended day: litres, sales, udhari given / received, payments, cash expected / counted, short / excess. Click a date for the full day (readings, balance, entries) and **Print / PDF**. Each ended day has an 8-letter **integrity code**, calculated from that day's figures when it was ended. Write it in the paper register: it lets a later check prove the day's records were not changed. (A screen that re-checks the code automatically is not built yet.)

## Udhari customers
Everyone with old balance, given, received, **outstanding** (red = owes, green = advance), car numbers, last entry. Search and sort. Click a name for the full account → **Print / PDF** to give the customer. A customer who still has no old balance shows **+ Add old balance**.

## Settings
| Tool | Use |
|---|---|
| Import old udhari | Excel from the old register; checked against the register's total; never twice |
| Starting readings | Each nozzle's meter on go-live day (once) |
| Staff logins | Add staff, reset password, disable login, sign out a lost phone; **Opens:** phone view (Udhari + My UPI) or full register (use full register for the counter laptop login) |
| Backups | Back up now, download to phone |
| Pump setup | Pump name, station and nozzle names |

## Rules the app enforces (so the books stay right)
- Fuel sales come **only** from the nozzle readings × rate. Udhari received, old balances, HPCL payments and bank deposits are never counted as sales.
- Nothing is ever deleted or edited; mistakes are cancelled with a reason and stay visible.
- A cash shortage is never written off as an expense automatically.
- Readings lower than the previous one are refused (and the attempt is recorded).
