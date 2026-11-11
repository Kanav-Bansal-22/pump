import { Bi, Card } from "@/components/ui";
import { Page } from "@/components/page";
import { niceTime } from "@/lib/format";
import { pool } from "@/server/db";
import { requireUser } from "@/server/session";
import { RunBackup } from "./run-backup";

export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  await requireUser("backup.manage");
  const c = await pool().connect();
  try {
    const list = (
      await c.query(
        `SELECT b.id, b.kind, b.finished_at, b.size_bytes, b.ok, b.error, b.sha256,
                (SELECT max(at) FROM backup_downloads d WHERE d.backup_id = b.id) AS downloaded_at
           FROM backup_log b ORDER BY b.finished_at DESC LIMIT 15`,
      )
    ).rows;
    const lastOk = list.find((b) => b.ok);
    const lastDl = (await c.query("SELECT max(at) AS at FROM backup_downloads")).rows[0].at as Date | null;
    const hours = (d: Date | null) => (d ? (Date.now() - new Date(d).getTime()) / 3600000 : Infinity);
    const backupAge = hours(lastOk?.finished_at ?? null);
    const dlAge = hours(lastDl);
    return (
      <Page title={<Bi en="Backups" hi="बैकअप" />} back="/settings">
        <Card className={`mb-4 border ${backupAge < 26 ? "border-green-600" : "border-red-600"}`}>
          <div className="text-lg font-bold">{backupAge < 26 ? "✅ Backup is recent" : "🔴 No backup in the last 26 hours"}</div>
          <div className="text-base">Last good backup: {lastOk ? niceTime(new Date(lastOk.finished_at).toISOString()) : "never"}</div>
          <div className={`mt-2 text-base ${dlAge < 26 ? "" : "font-semibold text-orange-600"}`}>
            Last copy saved to a phone: {lastDl ? niceTime(new Date(lastDl).toISOString()) : "never"}
            {dlAge >= 26 && " (please download today's backup: it is the only copy away from this laptop)"}
          </div>
          <div className="mt-1 text-sm opacity-80">बैकअप रोज़ फ़ोन में डाउनलोड करें। यही लैपटॉप के बाहर की एकमात्र कॉपी है।</div>
        </Card>
        <RunBackup />
        <Card className="mt-4">
          <h2 className="mb-2 text-lg font-bold">Recent backups</h2>
          <div className="space-y-2">
            {list.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-0">
                <div>
                  <div className="font-semibold">
                    {b.ok ? "✅" : "❌"} {b.kind} · {niceTime(new Date(b.finished_at).toISOString())}
                  </div>
                  <div className="text-sm text-muted">
                    {b.ok ? `${Math.round(Number(b.size_bytes) / 1024)} KB · ${String(b.sha256).slice(0, 12)}…` : b.error}
                    {b.downloaded_at && " · downloaded"}
                  </div>
                </div>
                {b.ok && (
                  <a href={`/api/owner/backups?id=${b.id}`} className="rounded-lg bg-brand px-3 py-2 font-semibold text-white">
                    Download
                  </a>
                )}
              </div>
            ))}
          </div>
        </Card>
      </Page>
    );
  } finally {
    c.release();
  }
}
