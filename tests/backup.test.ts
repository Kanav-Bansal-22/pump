import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Client } from "pg";
import { createHash } from "node:crypto";
import { createUser } from "@/server/auth/service";
import { createStandardLayout } from "@/server/config/service";
import { takeBackup } from "@/server/ops/backup";
import { restoreBackup } from "../scripts/lib/restore";
import { connect, tx } from "./helpers/db";

const PG_BIN = process.env.PG_BIN ?? "C:\\Program Files\\PostgreSQL\\16\\bin";
let dir = "";
let c: Client;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pump-backup-test-"));
  process.env.BACKUP_DIR = dir;
  c = await connect("app", "pump_test_backup");
  const err = await tx(c, async () => {
    const owner = await createUser(c, { name: "Owner B", username: "owner_b", tempPassword: "owner-pass-1", role: "OWNER" });
    await createStandardLayout(c, "Backup Test Pump");
    const nz = (await c.query("SELECT id FROM nozzles ORDER BY sort_order LIMIT 2")).rows;
    let k = 0;
    for (const n of nz) {
      await c.query("INSERT INTO meter_epochs (nozzle_id, epoch, int_digits, decimals, created_by) VALUES ($1,1,7,2,$2)", [n.id, owner]);
      for (const [reading, type, d, at] of [
        ["1000.00", "BASELINE", "2026-10-01", "2026-10-02 08:00+05:30"],
        ["1450.50", "DAY_END", "2026-10-02", "2026-10-03 08:00+05:30"],
        ["1900.25", "DAY_END", "2026-10-03", "2026-10-04 08:00+05:30"],
      ])
        await c.query(
          `INSERT INTO meter_points (nozzle_id, epoch, reading, cumulative, point_type, business_date, taken_at, effective_at, entered_by, idempotency_key)
           VALUES ($1,1,$2,0,$3,$4,$5,$5,$6,$7)`,
          [n.id, reading, type, d, at, owner, `backup-test-${++k}-xxxxxxxxxxxx`],
        );
    }
  });
  if (err) throw new Error(err);
});
afterAll(async () => {
  await c.end();
  rmSync(dir, { recursive: true, force: true });
});

describe("backup and restore (TC-31)", () => {
  it("backup -> restore into a new database: data, chains and chain heads all match the manifest", async () => {
    const db = inject("db");
    const conn = { host: db.host, port: String(db.port), backupPassword: db.pump_backup, appPassword: db.pump_app };
    const r = await takeBackup("MANUAL", "pump_test_backup", conn);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.chainProblems).toBe(0);

    // the manifest line matches the file
    const manifest = readFileSync(join(dir, "manifest.jsonl"), "utf8").trim().split("\n");
    const line = JSON.parse(manifest.at(-1)!);
    const fileSha = createHash("sha256").update(readFileSync(r.file!)).digest("hex");
    expect(line.sha256).toBe(fileSha);
    expect(line.meterChainHeads).toHaveLength(2);

    // restore as superuser into a brand new database
    const su = await connect("super");
    await su.query("DROP DATABASE IF EXISTS pump_restored");
    await su.query("CREATE DATABASE pump_restored OWNER pump_owner TEMPLATE template0");
    await su.end();
    const res = spawnSync(
      join(PG_BIN, "pg_restore.exe"),
      ["-h", db.host, "-p", String(db.port), "-U", "postgres", "-d", "pump_restored", "--exit-on-error", r.file!],
      { env: { ...process.env, PGPASSWORD: db.superPassword }, encoding: "utf8" },
    );
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);

    const restored = await connect("super", "pump_restored");
    try {
      expect((await restored.query("SELECT count(*)::int n FROM verify_meter_chains()")).rows[0].n).toBe(0);
      const heads = (await restored.query("SELECT nozzle_id, seq::text, head FROM v_meter_chain_heads ORDER BY nozzle_id")).rows;
      expect(heads).toEqual(line.meterChainHeads);
      const seg = await restored.query("SELECT SUM(throughput)::text t FROM v_meter_segments");
      expect(seg.rows[0].t).toBe("1800.50"); // 2 nozzles x (450.50 + 449.75)
      // immutability triggers came back with the restore
      await expect(restored.query("UPDATE meter_points SET reading = reading")).rejects.toThrow(/IMMUTABLE/);
    } finally {
      await restored.end();
    }
  });

  it("each manifest line is linked to the previous one; editing an old line breaks the link", async () => {
    const db = inject("db");
    const conn = { host: db.host, port: String(db.port), backupPassword: db.pump_backup, appPassword: db.pump_app };
    await takeBackup("MANUAL", "pump_test_backup", conn);
    const lines = readFileSync(join(dir, "manifest.jsonl"), "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < lines.length; i++) {
      expect(JSON.parse(lines[i]).prevLineSha256).toBe(createHash("sha256").update(lines[i - 1]).digest("hex"));
    }
    const forged = lines[0].replace(/"size":\d+/, '"size":1');
    expect(JSON.parse(lines[1]).prevLineSha256).not.toBe(createHash("sha256").update(forged).digest("hex"));
  });

  it("a failed backup is recorded as failed, never as success", async () => {
    const db = inject("db");
    const r = await takeBackup("MANUAL", "pump_test_backup", {
      host: db.host,
      port: String(db.port),
      backupPassword: "wrong-password",
      appPassword: db.pump_app,
    });
    expect(r.ok).toBe(false);
    const log = await c.query("SELECT ok, error FROM backup_log WHERE id = $1", [r.backupId]);
    expect(log.rows[0].ok).toBe(false);
    expect(log.rows[0].error).toMatch(/pg_dump failed/);
  });
});

describe("moving to another laptop (npm run db:restore)", () => {
  it("restores a backup into a new database, checks it against the manifest, and verifies the readings", async () => {
    const db = inject("db");
    const conn = { host: db.host, port: String(db.port), backupPassword: db.pump_backup, appPassword: db.pump_app };
    const b = await takeBackup("NIGHTLY", "pump_test_backup", conn);
    expect(b.ok).toBe(true);
    const opts = { file: b.file!, target: "pump_moved", host: db.host, port: db.port, superPassword: db.superPassword, migratorPassword: db.pump_migrator, log: () => {} };
    const r = await restoreBackup(opts);
    expect(r.manifest).toBe("MATCH");
    expect(r.chainProblems).toBe(0);
    expect(r.headsMatch).toBe(true);
    expect(r.migrationsApplied).toEqual([]); // same app version
    expect(r.counts["meter readings"]).toBe("6");
    expect(r.counts.logins).toBe("1");

    // the app role can work in the moved database (grants and settings came back)
    const app = await connect("app", "pump_moved");
    try {
      expect((await app.query("SELECT name FROM sites")).rows[0].name).toBe("Backup Test Pump");
      expect((await app.query("SHOW timezone")).rows[0].TimeZone).toBe("Asia/Kolkata");
      await expect(app.query("DELETE FROM meter_points")).rejects.toThrow();
    } finally {
      await app.end();
    }

    // never overwrites a database that has data
    await expect(restoreBackup(opts)).rejects.toThrow(/already has data/);
  });

  it("refuses a backup file that was changed after it was written", async () => {
    const db = inject("db");
    const conn = { host: db.host, port: String(db.port), backupPassword: db.pump_backup, appPassword: db.pump_app };
    const b = await takeBackup("MANUAL", "pump_test_backup", conn);
    appendFileSync(b.file!, "x");
    await expect(
      restoreBackup({ file: b.file!, target: "pump_tampered", host: db.host, port: db.port, superPassword: db.superPassword, migratorPassword: db.pump_migrator, log: () => {} }),
    ).rejects.toThrow(/changed or damaged/);
  });
});
