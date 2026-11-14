import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Client } from "pg";
import { migrate } from "../migrate";
import { provision } from "./provision";

const PG_BIN = () => process.env.PG_BIN ?? "C:\\Program Files\\PostgreSQL\\16\\bin";

export type RestoreInput = {
  file: string;
  target: string; // database to create, e.g. pump_prod
  host: string;
  port: number;
  superPassword: string;
  migratorPassword: string;
  /** manifest.jsonl to check the file against; default: the backups folder the file sits in */
  manifest?: string;
  log?: (s: string) => void;
};

export type RestoreResult = {
  manifest: "MATCH" | "NOT_LISTED" | "NO_MANIFEST";
  migrationsApplied: string[];
  chainProblems: number;
  headsMatch: boolean | null;
  counts: Record<string, string>;
};

/** Finds backups/manifest.jsonl for a file in backups/<kind>/x.dump (or next to it). */
function findManifest(file: string): string | null {
  for (const p of [join(dirname(file), "..", "manifest.jsonl"), join(dirname(file), "manifest.jsonl")]) if (existsSync(p)) return p;
  return null;
}

/**
 * Restores one backup file into a NEW database on this computer (moving to another laptop, or after a
 * disk failure). Steps: check the file against the backup manifest (refuses a file that was changed),
 * create the database (refuses one that already has tables), pg_restore as the superuser, re-apply the
 * database settings and grants, apply any newer migrations, then verify the meter-reading chains.
 */
export async function restoreBackup(i: RestoreInput): Promise<RestoreResult> {
  const log = i.log ?? console.log;
  if (!/^[a-z_]+$/.test(i.target)) throw new Error(`Bad database name "${i.target}" (small letters and _ only).`);
  if (!existsSync(i.file)) throw new Error(`Backup file not found: ${i.file}`);

  // 1. the file is the one the backup wrote (sha256 in the manifest)
  const sha = createHash("sha256").update(readFileSync(i.file)).digest("hex");
  const manifestPath = i.manifest ?? findManifest(i.file);
  let manifest: RestoreResult["manifest"] = "NO_MANIFEST";
  let line: { sha256: string; meterChainHeads?: Array<{ nozzle_id: string; seq: string; head: string }> } | undefined;
  if (manifestPath) {
    const lines = readFileSync(manifestPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
    const byName = lines.filter((l) => l.file === basename(i.file));
    line = lines.find((l) => l.sha256 === sha);
    if (byName.length && !line) throw new Error("This backup file does not match its record in manifest.jsonl: it was changed or damaged. Use another backup.");
    manifest = line ? "MATCH" : "NOT_LISTED";
  }
  log(`backup file: ${basename(i.file)} · ${manifest === "MATCH" ? "matches the backup record" : manifest === "NOT_LISTED" ? "not in manifest.jsonl (cannot be cross-checked)" : "no manifest.jsonl found (cannot be cross-checked)"}`);
  const list = spawnSync(join(PG_BIN(), "pg_restore.exe"), ["--list", i.file], { encoding: "utf8" });
  if (list.status !== 0 || !list.stdout.includes("TABLE DATA")) throw new Error(`Not a readable backup file: ${(list.stderr || "").slice(0, 200)}`);

  // 2. a fresh, empty database
  const su = new Client({ host: i.host, port: i.port, user: "postgres", password: i.superPassword, database: "postgres" });
  await su.connect();
  try {
    if ((await su.query("SELECT 1 FROM pg_database WHERE datname = $1", [i.target])).rowCount) {
      const t = new Client({ host: i.host, port: i.port, user: "postgres", password: i.superPassword, database: i.target });
      await t.connect();
      const n = (await t.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname = 'public'")).rows[0].n;
      await t.end();
      if (n > 0) throw new Error(`Database ${i.target} already has data. Restore into an empty one (nothing is overwritten).`);
      await su.query(`DROP DATABASE ${i.target}`); // empty: made by db:setup
    }
    await su.query(`CREATE DATABASE ${i.target} OWNER pump_owner ENCODING 'UTF8' TEMPLATE template0`);
  } finally {
    await su.end();
  }

  // 3. restore
  log(`restoring into ${i.target}...`);
  const r = spawnSync(join(PG_BIN(), "pg_restore.exe"), ["-h", i.host, "-p", String(i.port), "-U", "postgres", "-d", i.target, "--exit-on-error", i.file], {
    env: { ...process.env, PGPASSWORD: i.superPassword },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`pg_restore failed: ${(r.stderr || "").slice(0, 400)}`);

  // 4. database settings / grants (not inside a backup file), then newer migrations
  await provision({ host: i.host, port: i.port, superUser: "postgres", superPassword: i.superPassword, databases: [i.target], passwords: {} });
  const applied = await migrate({ host: i.host, port: i.port, migratorPassword: i.migratorPassword, database: i.target }, log);

  // 5. verify
  const c = new Client({ host: i.host, port: i.port, user: "postgres", password: i.superPassword, database: i.target });
  await c.connect();
  try {
    const chainProblems = (await c.query("SELECT count(*)::int n FROM verify_meter_chains()")).rows[0].n as number;
    const heads = (await c.query("SELECT nozzle_id, seq::text, head FROM v_meter_chain_heads ORDER BY nozzle_id")).rows;
    const headsMatch = line?.meterChainHeads ? JSON.stringify(heads) === JSON.stringify(line.meterChainHeads) : null;
    const q = async (sql: string) => String((await c.query(sql)).rows[0].v ?? "0");
    const counts = {
      "udhari customers": await q("SELECT count(*) v FROM parties WHERE kind = 'CUSTOMER' AND active"),
      "udhari total ₹": await q(
        "SELECT COALESCE(SUM(l.debit - l.credit), 0)::numeric(14,2)::text v FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1400'",
      ),
      "register entries": await q("SELECT count(*) v FROM money_entries"),
      "meter readings": await q("SELECT count(*) v FROM meter_points"),
      "ended days": await q("SELECT count(*) v FROM business_days WHERE status = 'LOCKED'"),
      logins: await q("SELECT count(*) v FROM users WHERE active"),
    };
    return { manifest, migrationsApplied: applied, chainProblems, headsMatch, counts };
  } finally {
    await c.end();
  }
}
