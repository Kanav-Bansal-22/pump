/**
 * Read-only smoke check of the real installation using the app's own restricted login.
 *   npx tsx scripts/smoke-check.ts
 */
import { Client } from "pg";
import { loadEnv } from "./lib/env";

const env = loadEnv();

async function check(db: string) {
  const c = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), user: "pump_app", password: env.DB_APP_PASSWORD, database: db });
  await c.connect();
  const out: string[] = [];
  const mustFail = async (label: string, sql: string) => {
    try {
      await c.query(sql);
      out.push(`FAIL (was allowed!) ${label}`);
    } catch {
      out.push(`ok   blocked: ${label}`);
    }
  };
  try {
    const who = (await c.query("SELECT current_user AS u, current_setting('TimeZone') AS tz")).rows[0];
    out.push(`ok   connected as ${who.u}, timezone ${who.tz}`);
    const n = (await c.query("SELECT (SELECT count(*) FROM accounts) a, (SELECT count(*) FROM payment_modes) p")).rows[0];
    out.push(`ok   ${n.a} ledger accounts, ${n.p} payment modes`);
    await mustFail("delete a configuration row", "DELETE FROM payment_modes WHERE code = 'OTHER'");
    await mustFail("create a table", "CREATE TABLE x (i int)");
    await mustFail("drop the journal", "DROP TABLE journal_lines");
    await mustFail("read password hashes of DB roles", "SELECT * FROM pg_authid");
  } finally {
    await c.end();
  }
  console.log(`--- ${db}\n${out.join("\n")}`);
}

(async () => {
  for (const db of ["pump_demo", "pump_prod"]) await check(db);
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
