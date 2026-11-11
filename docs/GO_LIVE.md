# Go-live checklist (target: 15 Nov 2026)

The paper Rokad is **kept in parallel for 2 weeks**. Every day, compare the app's Day summary with the register.

## A. At the pump, before go-live (14 Nov or earlier)

| # | Step | Who | Done |
|---|---|---|---|
| 1 | Put the laptop on the **pump's own Wi-Fi**. In Windows: Settings → Network → Wi-Fi → (pump network) → *Network profile type* = **Private**. | owner | ☐ |
| 2 | In the **router**, reserve the laptop's IP (DHCP reservation / "address binding"), so the address never changes. Write the IP here: `http://________________` | owner / helper | ☐ |
| 3 | Install the always-on server (one admin prompt: firewall for the pump Wi-Fi only, laptop never sleeps on mains):<br>`powershell -ExecutionPolicy Bypass -File scripts\install-server.ps1` | helper | ☐ |
| 4 | Windows: let the laptop **log in automatically** after a power cut (or make sure someone logs in). The server and backups start at login. | helper | ☐ |
| 5 | Each staff phone: join the pump Wi-Fi → Chrome → open the address from step 2 → ⋮ menu → **Add to Home screen**. Let Chrome save the password. | each person | ☐ |
| 6 | Switch to the **real database**:<br>`powershell -ExecutionPolicy Bypass -File scripts\use-database.ps1 prod`<br>The orange DEMO banner must disappear. | helper | ☐ |
| 7 | In the real app: create the **owner** account (first screen) → **Settings → Pump setup** → *Create layout* → **Settings → Staff logins**: one login per person (temporary password; they choose their own at first login). | owner | ☐ |
| 8 | Fill the **old udhari** template from the old register → **Settings → Import old udhari** → check the preview → type the register's total → confirm. | owner | ☐ |
| 9 | **Settings → Backups → Back up now**, then **Download** it to your phone. | owner | ☐ |

## B. Go-live morning (15 Nov, 8 AM)

| # | Step | Who | Done |
|---|---|---|---|
| 10 | **Settings → Starting readings**: type each nozzle's meter (twice). This is the opening for the first app day. | owner | ☐ |
| 11 | Register → **Rates** for 15 Nov. | anyone | ☐ |
| 12 | From now on all udhari, payments, milk, HPCL… go into the app **and** the paper register. | everyone | ☐ |

## C. Every day after that

| Time | What | Where on the register page |
|---|---|---|
| 8 AM | Today's petrol and diesel rates | Rates |
| 8 AM | Yesterday's closing of all 6 nozzles | Nozzle closing → *Save readings* |
| 8 AM | Count the cash → **End day** for yesterday | Day summary |
| all day | Udhari given / received, new customers, milk, HPCL, lube… | Udhari · New udhari customer · Other entry |
| daily (owner) | Download the backup to your phone | Settings → Backups |
| daily (2 weeks) | Compare Day summary with the paper register | Daily records |

A day can be ended only from **5 AM the next morning** (the night still belongs to that day).

## D. If something goes wrong

| Problem | What to do |
|---|---|
| Phone says *NOT saved: no connection* | Check the phone is on the **pump Wi-Fi** and the laptop is on. The typed values stay on the screen: press **Save** again (it never saves twice). |
| Nothing opens on phones | Is the laptop on and logged in? Open `http://localhost` on the laptop itself. Still nothing: restart the laptop. |
| Power cut | Laptop runs on battery; the **router** goes off, so phones cannot reach the app. Write on paper and enter it after the power returns (a ₹1,500 router UPS avoids this). |
| Typed a wrong udhari / payment | Owner: Day book → **cancel** (with a reason) → enter it again correctly. |
| Typed a wrong meter reading | It is not editable (by design). Tell the owner; corrections with approval are the next feature. |
| Forgot a password | Owner: Settings → Staff logins → **Reset password**. |
| Phone lost | Owner: Settings → Staff logins → **Sign out all phones** for that person. |
| Laptop broken / stolen | Get a new laptop, install PostgreSQL 16, restore the latest backup from your phone (see *Restore* below). |

### Restore (for the helper)
```
pg_restore -h 127.0.0.1 -U postgres -d pump_prod --clean --if-exists <backup file>.dump
```
Then `npm run db:migrate -- pump_prod` and start the server again. Test this once on a spare machine before you need it.
