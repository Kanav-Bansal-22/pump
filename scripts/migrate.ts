/**
 * Applies db/migrations/*.sql in order, each in its own transaction, as pump_owner.
 *
 *   npm run db:migrate              -> database named by DB_NAME in .env
 *   npm run db:migrate -- pump_test -> a specific database
 *
 * Applied migrations are recorded with their SHA-256. If an applied file is later edited,
 * the runner refuses to continue (migrations are append-only; write a new one instead).
 */
import { Client } from "pg";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "./lib/env";

export type MigrateTarget = { host: string; port: number; migratorPassword: string; database: string };

export async function migrate(t: MigrateTarget, log: (s: string) => void = console.log): Promise<string[]> {
  const client = new Client({ host: t.host, port: t.port, user: "pump_migrator", password: t.migratorPassword, database: t.database });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query("SET ROLE pump_owner");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Map<string, string>(
      (await client.query("SELECT name, sha256 FROM schema_migrations")).rows.map((r) => [r.name, r.sha256]),
    );
    const dir = join(process.cwd(), "db", "migrations");
    for (const f of readdirSync(dir).filter((x) => /^\d{4}_.+\.sql$/.test(x)).sort()) {
      const sql = readFileSync(join(dir, f), "utf8");
      const sha = createHash("sha256").update(sql).digest("hex");
      const prev = done.get(f);
      if (prev) {
        if (prev !== sha) throw new Error(`Migration ${f} was edited after being applied. Write a new migration instead.`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name, sha256) VALUES ($1, $2)", [f, sha]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${f} failed: ${e instanceof Error ? e.message : e}`);
      }
      applied.push(f);
      log(`applied ${f}`);
    }
  } finally {
    await client.end();
  }
  return applied;
}

if (process.argv[1] && /migrate\.ts$/.test(process.argv[1])) {
  const env = loadEnv();
  const database = process.argv[2] ?? env.DB_NAME;
  migrate({ host: env.DB_HOST, port: Number(env.DB_PORT), migratorPassword: env.DB_MIGRATOR_PASSWORD, database })
    .then((a) => console.log(a.length ? `${database}: ${a.length} migration(s) applied` : `${database}: up to date`))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
