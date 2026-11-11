# Security, Integrity & Backup Plan — v2.0

## 1. Network and host

| Control | Setting |
|---|---|
| Laptop IP | Reserved in router DHCP (e.g. 192.168.1.100) |
| PostgreSQL | `listen_addresses = 'localhost'`; Windows Firewall blocks 5432 inbound; `pg_hba` allows only 127.0.0.1/::1 with scram-sha-256 |
| App (Node) | binds 127.0.0.1:3000; reachable only through Caddy |
| Caddy | :443 (and :80 → redirect) allowed inbound **only from the LAN subnet** (Windows Firewall rule, Private profile) |
| Router | WPA2/WPA3, strong password; guest network isolated from the laptop; **no port forwarding**; UPnP off |
| Remote access | none in v1; future: Tailscale (free tier), never public ports |
| Power | Windows power plan: never sleep / hibernate when plugged in; lid-close = do nothing; Windows Update active hours set to business hours; BIOS "power on AC attach" if available |
| Clock | Windows time sync on (when internet available); app warns owner if server clock jumps > 2 min between checks |
| Hardware (recommend) | Line-interactive UPS ≥ 600 VA (1 kVA better) for **router + laptop**; SSD laptop; **two** external USB drives (rotation, §5) |

## 2. HTTPS on the LAN (simplest practical setup for Android)

1. Caddy runs `tls internal` and issues a certificate for the **IP address** (`https://192.168.1.100`). We use the IP, not `pump.local`, because Android Chrome resolves `.local` unreliably.
2. Export Caddy's root certificate once (`root.crt`). On each phone, open the setup page on Wi-Fi, download it, then go to *Settings → Security → Encryption & credentials → Install a certificate → CA certificate*. This takes about 5 minutes per phone and a photo guide is provided.
3. Open `https://192.168.1.100` in Chrome → menu → **Install app / Add to Home screen**.
4. If the reserved IP ever changes, the certificate is reissued. That is why the router reservation is mandatory.
5. Why this is worth it:
   - login passwords and cookies are encrypted on shared Wi-Fi
   - PWA install, camera and WhatsApp file-sharing (Web Share API) need HTTPS
6. Fallback, if a phone cannot install the CA: plain-HTTP home-screen shortcut. It works for entry, but there is no file-share and traffic is unencrypted. Documented, not recommended.

## 3. Application security

- **Logins:** individual logins only.
  - argon2id password hashing
  - forced password change on first login
  - progressive lockout (5 failures → 15 min)
  - all attempts logged
- **PIN (D17):** 4–6 digits, only on a device registered by a full-password login. 5 wrong PINs require the full password. The owner can revoke any device or session instantly (lost phone).
- **Sessions:**
  - HTTP-only, Secure, SameSite=Strict cookie
  - 12 h idle expiry for employees, 7 days for owner devices (setting)
  - token stored hashed
- **Authorisation:** server-side permission and station-scope check on **every** route (a central middleware plus per-handler `requirePermission`). Tests check every route for unauthorised roles.
- **CSRF:** SameSite=Strict + Origin header check on all POSTs.
- **Input:** Zod schemas; decimal strings parsed with a strict regex (no locale commas); parameterised SQL only.
- **Uploads:**
  - JPEG/PNG/PDF/XLSX/CSV only, size limit
  - photos re-encoded and resized on the client (~200 KB)
  - random file names, stored outside the web root, served through an authenticated route
  - SHA-256 recorded
- **Secrets:** `.env` only (never in git or the client bundle). A first-run script generates the DB passwords and session secret. The Postgres superuser password is written on paper and sealed with the owner.
- **Employees cannot:**
  - delete anything (no DELETE grant exists)
  - edit history (F tables are immutable)
  - approve their own events or reviews
  - see financial reports (permission `report.financial`)
  - access other stations (`user_stations`)
- **Audit:** DB trigger audit on every F/W/C table insert/update with user, IP, device and request id. The owner sees the audit viewer and an employee-activity report.

## 4. Tamper evidence (Correction C)

### 4.1 What is chained
1. **Meter chain (per nozzle):** each point stores `prev_hash` and `row_hash = SHA-256(prev_hash ‖ canonical(row))`, where canonical is `|`-joined fixed-format text of:
   - `nozzle_id, seq, epoch, wrap_count`
   - `reading` (2 dp), `cumulative` (2 dp)
   - `point_type, business_date, shift_id`
   - `effective_at`, `taken_at` (UTC, microseconds)
   - `entered_by, supersedes_id, meter_event_id, price_change_id, verification_id, is_estimate`
   - `photo sha256`, `idempotency_key`

   Genesis: `SHA-256('GENESIS|' ‖ nozzle_id)`. Computed in a trigger with pgcrypto, identically re-computable in the verification job. Formats are fixed, so a restore on another machine or timezone verifies the same (TC-31).
2. **Daily ledger digest (per station-day, at lock and nightly):** SHA-256 over the ordered canonical rows of that day's journal entries and lines, source documents, tests, flags, reviews and verifications, chained to the previous day's digest. This extends tamper evidence to money without hashing every row in a trigger.

### 4.2 Where the reference values live (independent of the live DB)
| Anchor | How | Why it's independent |
|---|---|---|
| `manifest.jsonl` on external drive A | Each nightly backup appends `{date, meter chain heads, ledger digests, backup sha256}`; previous lines never rewritten (writer refuses to modify, and a hash of the previous manifest line is included in each new line) | Not inside the DB |
| Drive B (rotated weekly, kept at home) | Full copy of backups + manifest | **Offline**: cannot be altered from the laptop |
| Printed daily closing report | Shows an 8-char **integrity code** (derived from the day's ledger digest + meter heads); owner files the paper | Paper cannot be rewritten |
| Owner phone (optional) | "Download today's integrity receipt" (small JSON/PDF) | Separate device |

### 4.3 Verification
- **Nightly job:**
  - recomputes every meter chain and every locked day's digest
  - compares them with the DB-stored heads **and** with the latest manifest on drive A
  - a mismatch shows a 🔴 alert on the owner dashboard and is written to `integrity_runs`
- **On demand:** the owner types an integrity code from a filed paper report, and the app recomputes it for that day and says MATCH / MISMATCH.
- **After restore** (monthly test and real restores): verify chains and digests, compare with the manifest (TC-31, TC-35).

### 4.4 Tests
| Test | Expectation |
|---|---|
| TC-22 | `UPDATE`/`DELETE`/`TRUNCATE` on `meter_points`, `journal_lines`, etc. as `pump_app` **and** as `pump_owner` → denied |
| TC-34 | As superuser: disable trigger, change a reading, re-enable → nightly verification FAILS and alerts |
| TC-35 | As superuser: rewrite a reading **and** recompute the whole chain consistently → DB-internal check passes, but comparison with manifest/offline/printed code **FAILS** (proves why independence matters) |
| TC-31 | Backup → restore to clean DB → all chains verify; heads equal manifest |
| TC-41 | Manifest writer refuses to alter earlier lines; a tampered manifest line breaks its own line-chain |

### 4.5 Limitations (stated honestly)
- Someone with Windows admin + Postgres superuser **and** access to drive B **and** the filed papers could hide a rewrite. The design makes this need several independent acts.
- Someone who enters a plausible false reading that agrees with dips, collections and cash will not be detected by hashing. Hashes prove *records were not changed after entry*, not that they were *true*. Triangulation (dips, deliveries, collections, cash, photos, blind verification) is the defence against false entries.
- A laptop thief gets the database. Mitigations:
  - BitLocker **is not available on Windows Home**; Device Encryption may be, depending on hardware (check in Phase 6)
  - strong Windows password
  - offline drive B encrypted (7-Zip AES-256, free)

## 5. Backups

| Kind | When | What | Where | Retention |
|---|---|---|---|---|
| Hourly | 07:00–23:00 (business hours, setting) | `pg_dump -Fc` | `backups/hourly` + drive A | 48 h |
| Nightly | 02:00 | `pg_dump -Fc` + uploads (incremental copy) + manifest line | `backups/daily` + drive A | 30 daily + 12 monthly |
| Weekly rotation | Owner swaps drive A ↔ B (Sunday) | everything on A | B goes home | — |
| Before migrations | automatically, before every schema migration | full dump | `backups/premigration` | keep 10 |

- Every backup records its SHA-256 and size in `backup_log` and the manifest.
- **Dashboard health card:**
  - last backup age (🔴 if > 26 h, or > 2 h during business hours for hourly)
  - drive A present / free space
  - last restore test result
  - last integrity run
  - DB size and connections
- **Monthly automated restore test:**
  - restore the latest nightly backup into `pump_restore_test`
  - run row counts, the trial balance, chain verification and manifest comparison
  - log the result; drop the scratch DB
  - **a backup is not trusted until a restore test passes**
- **Real restore & laptop migration:** `RESTORE.md` and `MIGRATE.md` with exact commands, rehearsed in Phase 6 on a second machine or a clean VM.
- **Optional offsite:** an encrypted copy of the nightly backup to the owner's personal cloud storage. Free tiers only, **not required**, off by default.

## 6. Operational security checklist (owner)
- [ ] Postgres superuser password sealed in envelope
- [ ] Windows account for the server has a strong password; employees do not use the laptop
- [ ] Router admin password changed from default
- [ ] Drive B taken home weekly
- [ ] Daily closing report printed and filed (integrity code)
- [ ] Revoke departed employees' logins the same day
