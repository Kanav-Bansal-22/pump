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
| Staff logins | Add staff, reset password, disable login, sign out a lost phone; **Opens:** phone view (Udhari + My UPI) or full register (use full register for the counter laptop login); **Own Paytm QR** tick for each worker with their own QR; and on/off: *workers type each UPI payment* |
| Backups | Back up now, download to phone |
| Pump setup | Pump name, station and nozzle names |

## Rules the app enforces (so the books stay right)
- Fuel sales come **only** from the nozzle readings × rate. Udhari received, old balances, HPCL payments and bank deposits are never counted as sales.
- Nothing is ever deleted or edited; mistakes are cancelled with a reason and stay visible.
- A cash shortage is never written off as an expense automatically.
- Readings lower than the previous one are refused (and the attempt is recorded).

## WhatsApp day summary
After **End day**, the Day summary shows **Send on WhatsApp**. It opens WhatsApp with the day's figures ready (sales, UPI / card, udhari, expenses, cash counted, short / excess, and any UPI / card mismatch). Choose the person and press send yourself; nothing is sent automatically. *Copy text* copies the same message. Every ended day in **Daily records** has the same button.

## Testing fuel
Fuel drawn to test a nozzle is entered in **Testing fuel** on the register (nozzle, litres, put back in tank or not). It is taken off that nozzle's sales at its next closing, so cash does not show short. Fuel not put back needs a reason. A wrong test can be cancelled (with a reason) by the person who entered it or by you, until the next closing takes it in.

## If the laptop goes off
- Everything already saved is safe. While it is off, phones cannot save: staff write amounts on paper and enter them when it is back (yesterday's entries only until 11 AM; after that, you enter them).
- If a phone shows "⚠ Not confirmed", press Save again once the laptop is back; it never saves twice. If the page was closed, check "My entries" first.
- The app and the backups start by themselves when the laptop is switched on; nobody needs to sign in. Give it 1–2 minutes.
- Keep the Wi-Fi router on the inverter, otherwise phones lose the app in a power cut even though the laptop runs on battery.

## Each worker's own Paytm QR
- In **Settings → Staff logins**, tick **Own Paytm QR** on each worker who has one. Paytm's day must be 8 AM to 8 AM, like the app.
- At **End day**, the UPI box becomes one box per worker's QR plus **Shop QR**. Type each QR's total from the Paytm Business app. The app adds them up as the day's UPI.
- The Day summary shows each worker: **typed on phone**, **Paytm total**, and ✓ or the difference (e.g. "₹500 on the QR not typed"). The WhatsApp message names any worker whose QR does not match.
- **Workers type each UPI payment** (Staff logins, top) is on at first. It catches fake or failed payment screens. If the totals always match for a few weeks you can switch it off; phones then take card payments only and only the Paytm totals count.

## Udhari for earlier days (catch-up)
The old balances were imported as on a date (e.g. 12 Nov). Udhari given or received **after** that date and before you started using the app:
- Register → **Udhari** → pick the customer → Given / Received → amount → in the day box choose **Earlier day…** and pick the date → *Save*.
- Only the owner sees *Earlier day…*, and only for udhari. It allows the days after the old balances' date (and at most 31 days back), not ended days. Days up to the old balances' date are refused: they are already inside the old balance.

## Remove a customer
Udhari customers → open the customer → **Remove this customer** (owner only) → write the reason → *Remove*.
- Their old (imported) balance is cancelled and they disappear from every list. Nothing is erased; the customer page still opens from old links and shows "Removed".
- If they have later udhari entries that leave money owing (or an advance), removing is refused: cancel those entries in the day book first, or enter the money received.

## Customer list: Debit / Credit
Like the Tally list: **Debit** = the customer owes the pump; **Credit** = advance (the pump owes them). The Grand total row adds each column; *Net udhari* = debit − credit.
