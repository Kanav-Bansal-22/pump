import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Client } from "pg";
import { loadEnv } from "../../../scripts/lib/env";

export type BackupKind = "HOURLY" | "NIGHTLY" | "MANUAL" | "PREMIGRATION";

export type BackupResult = {
  ok: boolean;
  file?: string;
  size?: number;
  sha256?: string;
  chainProblems?: number;
  error?: string;
  backupId?: number;
};

const PG_BIN = () => process.env.PG_BIN ?? "C:\\Program Files\\PostgreSQL\\16\\bin";
export const backupRoot = () => resolve(process.env.BACKUP_DIR ?? join(process.cwd(), "backups"));

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((res) => {
    const p = spawn(cmd, args, { env, windowsHide: true });
    let stderr = "";
    let stdout = "";
    p.stderr.on("data", (d) => (stderr += d));
    p.stdout.on("data", (d) => (stdout += d));
    p.on("error", (e) => res({ code: -1, stderr: String(e), stdout }));
    p.on("close", (code) => res({ code: code ?? -1, stderr, stdout }));
  });
}

function sha256File(path: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash("sha256");
    createReadStream(path)
      .on("data", (d) => h.update(d))
      .on("error", rej)
      .on("end", () => res(h.digest("hex")));
  });
}

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/**
 * Takes one backup: pg_dump (custom format) as the read-only pump_backup role, verifies the archive is
 * readable (pg_restore --list), hashes it, appends a hash-linked line to backups/manifest.jsonl with every
 * meter chain head, copies to BACKUP_COPY_DIR if set, records backup_log, prunes old files.
 */
export async function takeBackup(
  kind: BackupKind,
  database?: string,
  conn?: { host: string; port: string; backupPassword: string; appPassword: string },
): Promise<BackupResult> {
  const loaded = conn ? null : loadEnv();
  const env = conn
    ? { DB_HOST: conn.host, DB_PORT: conn.port, DB_BACKUP_PASSWORD: conn.backupPassword, DB_APP_PASSWORD: conn.appPassword, DB_NAME: database! }
    : loaded!;
  const db = database ?? env.DB_NAME;
  const started = new Date();
  const dir = join(backupRoot(), kind.toLowerCase());
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${db}_${stamp(started)}_${kind.toLowerCase()}.dump`);
  const pgEnv = { ...process.env, PGPASSWORD: env.DB_BACKUP_PASSWORD };
  let result: BackupResult = { ok: false };
  try {
    const dump = await run(join(PG_BIN(), "pg_dump.exe"), ["-Fc", "-h", env.DB_HOST, "-p", env.DB_PORT, "-U", "pump_backup", "-d", db, "-f", file], pgEnv);
    if (dump.code !== 0) throw new Error(`pg_dump failed: ${dump.stderr.trim().slice(0, 400)}`);
    const list = await run(join(PG_BIN(), "pg_restore.exe"), ["--list", file], pgEnv);
    if (list.code !== 0 || !list.stdout.includes("TABLE DATA")) throw new Error(`backup file is not readable: ${list.stderr.slice(0, 200)}`);
    const size = statSync(file).size;
    const sha = await sha256File(file);

    const ro = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), user: "pump_backup", password: env.DB_BACKUP_PASSWORD, database: db });
    await ro.connect();
    let heads: Array<{ nozzle_id: string; seq: string; head: string }> = [];
    let problems = 0;
    try {
      heads = (await ro.query("SELECT nozzle_id, seq::text, head FROM v_meter_chain_heads ORDER BY nozzle_id")).rows;
      problems = (await ro.query("SELECT count(*)::int n FROM verify_meter_chains()")).rows[0].n;
    } finally {
      await ro.end();
    }

    const manifestPath = join(backupRoot(), "manifest.jsonl");
    const prevLine = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8").trimEnd().split("\n").pop() ?? "" : "";
    const line = {
      at: new Date().toISOString(),
      kind,
      db,
      file: basename(file),
      size,
      sha256: sha,
      meterChainHeads: heads,
      meterChainProblems: problems,
      prevLineSha256: prevLine ? createHash("sha256").update(prevLine).digest("hex") : null,
    };
    appendFileSync(manifestPath, JSON.stringify(line) + "\n", "utf8");

    const copyDir = process.env.BACKUP_COPY_DIR;
    if (copyDir) {
      mkdirSync(copyDir, { recursive: true });
      copyFileSync(file, join(copyDir, basename(file)));
      copyFileSync(manifestPath, join(copyDir, "manifest.jsonl"));
    }
    result = { ok: true, file, size, sha256: sha, chainProblems: problems };
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    if (existsSync(file) && !result.ok) {
      try {
        unlinkSync(file);
      } catch {
        /* keep going: the log row records the failure */
      }
    }
  }

  // Record the outcome (success or failure) so the owner's dashboard shows it.
  const app = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), user: "pump_app", password: env.DB_APP_PASSWORD, database: db });
  await app.connect();
  try {
    const r = await app.query(
      `INSERT INTO backup_log (kind, started_at, finished_at, path, size_bytes, sha256, ok, manifest_written, error)
       VALUES ($1, $2, now(), $3, $4, $5, $6, $6, $7) RETURNING id`,
      [kind === "PREMIGRATION" ? "PREMIGRATION" : kind, started, result.file ?? null, result.size ?? null, result.sha256 ?? null, result.ok, result.error ?? null],
    );
    result.backupId = Number(r.rows[0].id);
  } finally {
    await app.end();
  }
  if (result.ok) prune();
  return result;
}

/** Keeps hourly backups for 48 hours; nightly: last 30 plus the first of each month for 12 months; manual: last 20. */
export function prune(now = Date.now()): string[] {
  const removed: string[] = [];
  const list = (k: string) => {
    const d = join(backupRoot(), k);
    if (!existsSync(d)) return [];
    return readdirSync(d)
      .filter((f) => f.endsWith(".dump"))
      .map((f) => ({ f, path: join(d, f), t: statSync(join(d, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
  };
  const del = (p: string) => {
    unlinkSync(p);
    removed.push(p);
  };
  for (const x of list("hourly")) if (now - x.t > 48 * 3600 * 1000) del(x.path);
  list("manual").slice(20).forEach((x) => del(x.path));
  const nightly = list("nightly");
  const keepMonthly = new Set<string>();
  const seenMonth = new Set<string>();
  for (const x of [...nightly].reverse()) {
    const m = new Date(x.t).toISOString().slice(0, 7);
    if (!seenMonth.has(m)) {
      seenMonth.add(m);
      keepMonthly.add(x.path);
    }
  }
  const months = [...seenMonth].sort().slice(-12);
  nightly.forEach((x, i) => {
    const m = new Date(x.t).toISOString().slice(0, 7);
    const monthlyKeeper = keepMonthly.has(x.path) && months.includes(m);
    if (i >= 30 && !monthlyKeeper) del(x.path);
  });
  return removed;
}
