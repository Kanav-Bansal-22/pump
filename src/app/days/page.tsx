import Link from "next/link";
import { Page } from "@/components/page";
import { Panel } from "@/components/ui";
import { inr, niceDate, num } from "@/lib/format";
import { pool } from "@/server/db";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

type Fig = {
  sales: { total: string; byFuel: Record<string, { litres: string }> };
  udhariGiven: string;
  udhariReceived: string;
  payments: string;
  expectedCash: string;
  counted: string | null;
  difference: string | null;
  override: { reason: string } | null;
};

/** Daily records: every ended day, frozen at the moment it was ended. */
export default async function DaysPage() {
  const user = await requireUser();
  const isOwner = user.role === "OWNER";
  const c = await pool().connect();
  try {
    const rows = (
      await c.query(
        `SELECT d.business_date::text AS date, d.status, s.figures, s.integrity_code, u.name AS ended_by, d.locked_at
           FROM business_days d
           LEFT JOIN day_snapshots s ON s.site_id = d.site_id AND s.business_date = d.business_date AND s.kind = 'LOCK'
           LEFT JOIN users u ON u.id = d.locked_by
          WHERE d.status = 'LOCKED' ORDER BY d.business_date DESC LIMIT 120`,
      )
    ).rows as Array<{ date: string; status: string; figures: Fig; integrity_code: string; ended_by: string; locked_at: Date }>;
    return (
      <Page title="Daily records · दैनिक हिसाब" active="days" wide>
        <Panel title={`${rows.length} ended days`} right="click a date for the full day">
          <div className="overflow-x-auto">
            <table className="reg min-w-[60rem]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="text-right">Petrol L</th>
                  <th className="text-right">Diesel L</th>
                  <th className="text-right">Fuel sales</th>
                  <th className="text-right">Udhari given</th>
                  <th className="text-right">Udhari recd</th>
                  <th className="text-right">Paid</th>
                  {isOwner && <th className="text-right">Cash expected</th>}
                  <th className="text-right">Cash counted</th>
                  {isOwner && <th className="text-right">Short / excess</th>}
                  <th>Ended by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const f = r.figures;
                  const d = f?.difference;
                  return (
                    <tr key={r.date} className="hover:bg-soft">
                      <td className="whitespace-nowrap">
                        <Link href={`/days/${r.date}`} className="font-semibold text-accent hover:underline">
                          {niceDate(r.date)}
                        </Link>
                        {f?.override && <span title={f.override.reason} className="ml-1 text-xs text-orange-700">⚠</span>}
                      </td>
                      <td className="num">{num(f?.sales.byFuel.PETROL?.litres ?? "0")}</td>
                      <td className="num">{num(f?.sales.byFuel.DIESEL?.litres ?? "0")}</td>
                      <td className="num font-semibold">{inr(f?.sales.total)}</td>
                      <td className="num">{inr(f?.udhariGiven)}</td>
                      <td className="num">{inr(f?.udhariReceived)}</td>
                      <td className="num">{inr(f?.payments)}</td>
                      {isOwner && <td className="num">{inr(f?.expectedCash)}</td>}
                      <td className="num">{inr(f?.counted)}</td>
                      {isOwner && (
                        <td className={`num ${d && d !== "0.00" ? (d.startsWith("-") ? "text-red-700" : "text-orange-700") : "text-green-700"}`}>
                          {d == null ? "" : d === "0.00" ? "✓" : `${d.startsWith("-") ? "short" : "excess"} ${inr(d.replace("-", ""))}`}
                        </td>
                      )}
                      <td className="text-sm text-muted">{r.ended_by}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="text-muted">
                      No day has been ended yet. Use “End day” on the register.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </Page>
    );
  } finally {
    c.release();
  }
}
