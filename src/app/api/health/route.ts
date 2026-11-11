import { NextResponse } from "next/server";
import { pool } from "@/server/db";

/**
 * Health check for the watchdog and the install script: is the app up and can it reach the database?
 * Public, so it reveals nothing about the business (no figures, no names).
 */
export async function GET() {
  const started = Date.now();
  try {
    const r = await pool().query(
      `SELECT now() AS now,
              (SELECT EXTRACT(EPOCH FROM now() - max(finished_at)) / 3600 FROM backup_log WHERE ok)::int AS backup_hours,
              (SELECT count(*)::int FROM verify_meter_chains()) AS chain_problems`,
    );
    const x = r.rows[0];
    const backupOk = x.backup_hours != null && x.backup_hours <= 26;
    return NextResponse.json(
      { ok: true, db: true, backupOk, chainOk: x.chain_problems === 0, ms: Date.now() - started, at: x.now },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ ok: false, db: false, ms: Date.now() - started }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
