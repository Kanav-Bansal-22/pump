# Handwritten Rokad → App Mapping (from register page 224, dated 9-11-2026)

Source: owner's photo of the cash book (रोकड़). The owner confirmed that **the inputs on this page are the only daily inputs** and that:
- **left page = udhari given** (credit sales)
- **right page = meter readings, fuel sales and udhari received**

Readings below were transcribed from handwriting and may contain digit errors. They are used here only to understand the layout, **never as real data in the app**.

## 1. Right page — sales and udhari received

| Register line | Meaning | App input |
|---|---|---|
| `HSD A1  18,49,583.37 / 18,47,703.80 → 1,879.57` | Diesel nozzle: closing / opening → litres | Employee types **closing only**; opening and litres are automatic |
| `HSD A2  16,59,170.43 / 16,57,253.93 → 1,916.50` | Diesel nozzle | same |
| `MS A1  10,28,910.49 / 10,28,219.48 → 691.01` | Petrol (MS) nozzle | same |
| `MS A2  7,64,439.42 / 7,64,261.82 → 177.60` | Petrol nozzle | same |
| `HSD A1  84,96,290.94 / …` and `HSD A2  38,46,002.x / …` | Second diesel unit | same |
| `MS 868.61 × 105.17` → `91,351` | Petrol litres × today's rate | Rate entered once a day by owner at the 8 AM change; value automatic |
| `HSD … × 95.11` → `7,90,004` | Diesel litres × rate | automatic |
| `62` | small add-on line ("Rech…") | **unclear: see question R1** |
| `8,81,417` | Total fuel sales | automatic |
| `+3,17,764 Deepak Garg`, `+1,000 Gurminder cash`, `+1,80,000 Jagjeet … loan` | **Udhari received** (and possibly a loan) | "Customer repayment" screen; the loan line may be a different type (R2) |
| `13,80,181` | Sales + udhari received | automatic |
| `13,79,250` | Total of the other side (see §2) | automatic |
| `931` | Difference (short / excess) | automatic, never auto-expensed |

**Meter format confirmed by the photo:** 7 digits before the decimal point and 2 after (e.g. 84,96,290.94). Maximum 99,99,999.99, rollover modulus 1,00,00,000.

**Arithmetic check:** petrol 691.01 + 177.60 = 868.61 L ✓, and 868.61 × 105.17 = 91,351.71 ✓.
From the photo the four diesel nozzles appear to total about 8,935.82 L, while the written diesel total reads about 8,306.28 L. This is probably a transcription error on our side. It shows the kind of mismatch the app will make impossible, because litres are computed, not added by hand.

## 2. Left page — udhari given and other payments

| Register line | Meaning | App input |
|---|---|---|
| `CASH 8,59,314` (top) | Cash counted at end of day | "Close day → cash counted" (entered once a day) |
| `Bittu Khan  3241  27598  3,050` | Credit sale: customer, vehicle no., slip/folio no., amount | "Customer credit (उधारी)" screen: customer, vehicle, slip no., amount |
| `"  7495  27593  3,200` (ditto marks) | same customer, other vehicle | customer remembered; vehicle list per customer |
| … ~20 lines … total `3,53,588` | Total udhari given | automatic |
| `milk 250 / 300 → 550`, `… 1,052` | Small expenses | "Payment" screen with category |
| `Return 1,53,596` | **unclear: see R3** | — |
| `HPCL …` | Payment to HPCL (fuel supplier) | "Payment → supplier" (not an expense) |
| `13,79,250` | Total of left side used in the daily balance | automatic |

## 3. The register's daily balance (as the app will compute it)

```
  Fuel sales (meters × rate)          8,81,417
+ Udhari received                     4,98,764
= Money to account for               13,80,181
− Udhari given                        3,53,588
− Payments (milk, misc, HPCL, return…)
= Cash that should be in hand
  Cash counted                        8,59,314
  Difference                              931   (short or excess)
```

This is the same formula as ACCOUNTING_WORKFLOWS §6–7:
- cash sales = fuel sales − udhari given (− UPI/card, if recorded)
- udhari received adds to cash
- payments reduce cash

The app shows it in this exact order so it looks like the Rokad.

## 4. Daily inputs in the app (complete list)

1. Closing reading for each of the 6 nozzles (once a day).
2. Today's petrol and diesel rate (owner, at the 8 AM change).
3. Each udhari given: customer, vehicle, slip no., amount.
4. Each udhari received: customer, amount, mode.
5. Each payment: description or category (milk, HPCL, …), amount.
6. Lubricant sales: amount (as "Other sales").
7. Cash counted at end of day (one number).

Everything else (litres, sales, totals, customer balances, difference, reports) is calculated.

## 5. Still to clarify (small)
- **R1** What is the "62" / "Rech…" line on the right page?
- **R2** "Jagjeet … loan 1,80,000": is this a customer paying udhari, or a loan received by the business? A loan is not a sale and not udhari; it is recorded as a loan.
- **R3** What is "Return 1,53,596" on the left page (money paid back to someone, bank deposit, UPI/online collection)?
- **R4** Is UPI / Paytm money included inside "Cash 8,59,314", or is it not written in the register at all?
