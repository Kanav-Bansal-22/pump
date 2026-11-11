# Requirements Traceability — master prompt → design → phase → test

Legend for the Doc column: FA = FINAL_ARCHITECTURE, DS = DATABASE_SCHEMA, AW = ACCOUNTING_WORKFLOWS, SB = SECURITY_AND_BACKUP_PLAN, OQ = OPEN_QUESTIONS.
Status: all **Designed**; none implemented yet.

| Part | Requirement | Module | Doc | Phase | Verified by |
|---|---|---|---|---|---|
| 1 | 3 stations × 2 nozzles, Diesel/Diesel/Petrol | config | FA §2, DS 3.1 | 2 | seed + config tests; OQ Q1 |
| 1 | Owner / Manager / Employee users | auth | DS 3.1 | 2 | route permission tests |
| 1 | Central DB, live owner dashboard, same data for all | events, dashboard | FA §1 | 2/5 | two-phone SSE test |
| 1 | Credit sale updates balance, DSR and dashboard immediately | sales, ledger | AW §6 #1 | 4 | ACC-01 |
| 2 | Zero monthly cost, local laptop server, no mandatory cloud | ops | FA §1, D1 | 6 | install docs review |
| 2 | Works without internet on LAN | all | FA §1 | 6 | test with WAN unplugged |
| 2 | Clear not-saved state, keep form, retry, no false success | UI, idempotency | FA §5, D9 | 2/6 | Wi-Fi drop test, TC-19 |
| 2 | Next.js + TS + PG16 + Prisma + SQL migrations | — | FA 1.1 | 2 | — |
| 2 | Local HTTPS/PWA, Android guide | ops | SB §2 | 6 | phone install checklist |
| 2 | PG not exposed, no port forwarding | ops | SB §1 | 2/6 | port scan from phone |
| 2 | Auto-start, no sleep, reserved IP, auto backups, health on dashboard | ops | SB §1, §5 | 2/6 | reboot test |
| 3 | RBAC, station scoping, individual logins, PIN option | auth | SB §3, D17 | 2 | permission matrix tests |
| 3 | Employees can't delete/edit/approve own/see restricted | auth, triggers | SB §3 | 2/3 | TC-22, TC-25 |
| 4.1 | Dashboard tiles; sales ≠ collections; repayments/settlements/transfers not revenue | dashboard, ledger | AW §1, §6 | 5 | INV-02…07, INV-10 |
| 4.2 | Cumulative totalizers, opening derived, never typed | meters | AW §3.2 | 3 | TC-01, TC-06 |
| 4.2 | Shift, day-end, verification, price-change, reset, rollover, replacement, corrections | meters | AW §3 | 3 | TC-05…13, TC-21, TC-33 |
| 4.2 | Blocks (negative, decimals, range, lower, duplicate, stale, sequence) | meters | v1.1 H1–H9 + D4f | 3 | TC-07, 17, 18, 19, 26, 28, 42 |
| 4.2 | Flags (missing, high/low, rate, verify mismatch, late, tests, cross-check) | meters | v1.1 F1–F14 | 3 | TC-12…16 |
| 4.2 | Log blocked attempts | meters | DS 3.3 | 3 | TC-07 |
| 4.2 | Rollover vs reset vs replacement, evidence, four-eyes | meters | D4b, AW §3.4 | 3 | TC-08/08b/08c/09/10/33 |
| 4.2 | Six-nozzle tiles + full chain drill-down | dashboard | v1.1 §7 | 3 | TC-29 |
| 5 | Three test quantities, formulas, stock loss separate | meters, stock | AW §5 | 3 | TC-02, TC-03, TC-04 |
| 5 | No double deduction of tests not returned | stock | D6 | 3 | **INV-09** |
| 6 | Multiple prices per day, atomic boundary, no mis-pricing, retro with approval | pricing | D4d, AW §4 | 3 | TC-05, 23, 36–38 |
| 7 | Udhari page fields, history, ledger formula, sign convention | parties | AW §9 | 4 | INV-12 |
| 7 | Opening import with preview, duplicates, confirmation, reconciliation, batch hash | import | AW §9 | 4 | IMP-01…06 |
| 7 | Statements PDF/print/WhatsApp | reports | AW §9, D11 | 4 | statement totals test |
| 7 | Repayments not revenue | ledger | AW §6 #2 | 4 | INV-03 |
| 8 | Supplier ledger, bills, payments, statements; no double expense | parties | AW §10 | 4 | INV-05, ACC-05 |
| 9 | Payment modes incl. Paytm, credit, other | config | DS 3.1, C12 | 2 | ACC-06 |
| 9 | Receipt and payment screens with listed fields | cash | DS 3.5 | 4 | UI tests |
| 9 | Daily/station/consolidated cashbook, filters, totals, breakdowns | reports | AW §7 | 4/5 | drill-down sum tests |
| 9 | Posting model enforces no double counting | ledger | D3 | 2/4 | INV-01…08 |
| 10 | Expected vs actual cash, shortage/excess, never auto-expensed | cash | AW §7 | 4/5 | ACC-04 |
| 11 | Tanks, opening stock, deliveries, invoices, dips, calibration, variation, loss | stock | DS 3.4, AW §5 | 3 | TC-04, TC-45 |
| 11 | Pre/post delivery dips | stock | D18 | 3 | TC-45 |
| 12 | Closing tiles, drill-down, guards, override, immutable snapshot, visible corrections | closing | AW §8 | 5 | TC-24, INV-14, ACC-07 |
| 13 | 22 reports with date/station filters, PDF/Excel/print | reports | IR Phase 5 | 5 | export total tests |
| 14 | Exact decimals, FKs, uniques, transactions, append-only, reversal corrections | all | DS §1–4 | 2–5 | lint + TC-22 |
| 14 | Idempotency keys | all | D9 | 2 | TC-19 |
| 14 | Audit log | audit | DS 3.2 | 2 | audit tests |
| 14 | Hash chain + triggers + nightly check + **independent** anchors + limitations | integrity | SB §4 | 2/3/6 | TC-22, 31, 34, 35, 41 |
| 15 | Mobile-first, big inputs, numeric keyboard, Hindi/English, 6-button home, PWA, no offline queue | UI | FA §5 | 3–6 | Playwright mobile flows |
| 16 | Future hooks only (`payment_events`, `integrations`) | future | DS 3.7 | 2 | tables exist, no code |
| 17 A–G | Mandatory corrections | — | FA §3.2 | 3–5 | see FA §3.2 table |
| 19 | Dev rules (no fake data as real, demo separation, tests, honesty) | process | D14, IR §4 | all | phase reports |
