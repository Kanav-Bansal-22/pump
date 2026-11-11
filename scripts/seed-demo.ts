/**
 * DEMO ONLY: gives the practice database starting readings dated yesterday (so staff can practise
 * today's closing straight away) and today's rates. Values are the openings from register page 224.
 * Refuses to run against pump_prod. Run: npm run seed:demo
 */
import { Client } from "pg";
import { loadEnv } from "./lib/env";

const OPENINGS: Record<string, string> = {
  "S1:HSD A1": "1847703.80",
  "S1:HSD A2": "1657253.93",
  "S2:HSD A1": "8492191.87",
  "S2:HSD A2": "3844961.65",
  "S3:MS A1": "1028219.48",
  // S3:MS A2 left empty on purpose: practise the owner's "Starting readings" screen with it.
};

async function main() {
  const env = loadEnv();
  const db = process.argv[2] ?? "pump_demo";
  if (db !== "pump_demo") throw new Error("seed-demo only runs against pump_demo");
  const c = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), user: "pump_app", password: env.DB_APP_PASSWORD, database: db });
  await c.connect();
  try {
    await c.query("BEGIN");
    const owner = (await c.query("SELECT id FROM users WHERE role_code = 'OWNER' AND active ORDER BY created_at LIMIT 1")).rows[0]?.id;
    const site = (await c.query("SELECT id FROM sites LIMIT 1")).rows[0]?.id;
    if (!owner || !site) throw new Error("Create the owner and the pump layout in the app first.");
    await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.request_id', 'seed-demo', true)", [owner]);
    const d = (await c.query("SELECT reading_business_date($1, now())::text AS today, (reading_business_date($1, now()) - 1)::text AS yday", [site])).rows[0];
    const nz = await c.query("SELECT n.id, s.code || ':' || n.label AS k FROM nozzles n JOIN stations s ON s.id = n.station_id");
    let added = 0;
    for (const n of nz.rows) {
      const reading = OPENINGS[n.k];
      if (!reading) continue;
      if ((await c.query("SELECT 1 FROM meter_points WHERE nozzle_id = $1", [n.id])).rowCount) continue;
      await c.query("INSERT INTO meter_epochs (nozzle_id, epoch, int_digits, decimals, created_by) VALUES ($1,1,7,2,$2)", [n.id, owner]);
      await c.query(
        `INSERT INTO meter_points (nozzle_id, epoch, reading, cumulative, point_type, business_date, taken_at, effective_at, entered_by, idempotency_key)
         VALUES ($1, 1, $2, 0, 'BASELINE', $3, now() - interval '1 day', now() - interval '1 day', $4, $5)`,
        [n.id, reading, d.yday, owner, `seed-demo-${n.id}`],
      );
      added++;
    }
    for (const [fuel, rate] of [["DIESEL", "95.11"], ["PETROL", "105.17"]]) {
      const has = await c.query(
        "SELECT 1 FROM v_daily_rates r JOIN fuel_types f ON f.id = r.fuel_type_id WHERE f.code = $1 AND r.business_date = $2",
        [fuel, d.today],
      );
      if (!has.rowCount)
        await c.query(
          "INSERT INTO daily_rates (site_id, fuel_type_id, business_date, rate, set_by) SELECT $1, id, $3, $4, $5 FROM fuel_types WHERE code = $2",
          [site, fuel, d.today, rate, owner],
        );
    }
    await c.query("COMMIT");
    console.log(`DEMO seeded: ${added} starting readings dated ${d.yday}; rates for ${d.today}.`);
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
