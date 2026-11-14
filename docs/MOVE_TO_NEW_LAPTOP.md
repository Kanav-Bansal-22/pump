# Moving the pump app to another laptop · दूसरे लैपटॉप पर ले जाना

The **code** and the **data** travel separately:

| What | Where it lives | How it moves |
|---|---|---|
| The app (code) | the project folder | `git clone`, or copy the folder (leave out `node_modules` and `.next`) |
| Your data (customers, udhari, readings, days, logins) | PostgreSQL on the old laptop | one **backup file** + `manifest.jsonl`, restored with `npm run db:restore` |
| Database passwords (`.env`) | project folder, never in git | **not copied**: the new laptop makes its own in step 5 |

Logins (usernames and passwords) come with the data, so everyone logs in as before. Everyone has to log in once again on the new laptop.

> ⚠️ A backup file holds **all** your data and is not encrypted. Carry it on your own pen drive, never send it on WhatsApp / email / Google Drive, and delete it from the pen drive once the move is done.

---

## On the OLD laptop

1. **End the day** as usual, so nothing is half-entered.
2. **Take a fresh backup:** Settings → Backups → *Back up now*
   (or in the project folder: `npm run backup -- MANUAL`).
3. Copy to the pen drive:
   - the newest file in `backups\manual\` (e.g. `pump_prod_20261120-101500_manual.dump`)
   - `backups\manifest.jsonl` (lets the new laptop check the file is not damaged)
4. From now on, **enter nothing on the old laptop** (anything entered after the backup would not move).

## On the NEW laptop

5. Install, once:
   - **Node.js LTS** (nodejs.org) and **Git**
   - **PostgreSQL 16** (keep port 5432; write the superuser password on paper; *do not* open it to the network)
6. Get the app: `git clone <your repository>` (or copy the folder), then in that folder:
   ```
   npm install
   npm run db:setup
   ```
   `db:setup` asks for the PostgreSQL superuser password and creates the databases and a new `.env`.
7. Put the pen-drive files in place:
   - the `.dump` file → `backups\manual\`
   - `manifest.jsonl` → `backups\`
8. **Restore:**
   ```
   npm run db:restore -- backups\manual\pump_prod_20261120-101500_manual.dump pump_prod
   ```
   It asks for the superuser password again, then shows the moved figures (customers, udhari total, entries, readings, ended days, logins). **Compare them with the old laptop** (Udhari customers page total, Daily records). It refuses a damaged or changed file, and it never overwrites a database that already has data.
   *(Moving the practice data instead? Use `pump_test` as the last word.)*
9. In `.env`, set `DB_NAME=pump_prod` (or whatever you restored into).
10. Start it for good (one admin prompt each):
    ```
    powershell -ExecutionPolicy Bypass -File scripts\install-server.ps1
    powershell -ExecutionPolicy Bypass -File scripts\schedule-backups.ps1
    ```
    The installer prints the address for phones, e.g. `http://192.168.1.5`. The pump Wi-Fi must be set to **Private** on this laptop.
11. On each phone, open the **new address** and log in. Remove the old home-screen shortcut.
12. Check: Settings → Backups shows a backup within the hour.

## Then, on the OLD laptop

13. Switch the old server off so phones never reach two different copies:
    ```
    powershell -ExecutionPolicy Bypass -File scripts\uninstall-server.ps1
    ```
    Keep the old laptop's `backups` folder for a month as a spare copy, then delete it.
14. Delete the backup file from the pen drive.

## If something goes wrong

| Message | What to do |
|---|---|
| *does not match its record in manifest.jsonl* | The file was damaged while copying. Copy it again, or use an older backup. |
| *already has data* | You restored once already. Nothing was overwritten. Use the database you restored, or ask the helper to empty it. |
| *password authentication failed for user "postgres"* | Wrong PostgreSQL superuser password (the one from installing PostgreSQL in step 5). |
| *meter readings do not verify* | Do not use it. Restore an older backup. |
