import { notFound } from "next/navigation";
import { Page } from "@/components/page";
import { Panel } from "@/components/ui";
import { inr, niceDate, num } from "@/lib/format";
import { pool } from "@/server/db";
import { getDaySheet } from "@/server/meters/service";
import { ENTRY_KINDS, getDayBalance } from "@/server/money/service";
import { requireUser } from "@/server/session";
import { PrintButton } from "../../customers/[id]/print-button";

export const dynamic = "force-dynamic";

/** One day in full: nozzle readings, the register balance and every entry. */
export default async function DayPage({ params }: PageProps<"/days/[date]">) {
  const user = await requireUser();
  const isOwner = user.role === "OWNER";
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const c = await pool().connect();
  try {
    const sheet = await getDaySheet(c, date);
    const b = await getDayBalance(c, date);
    const snap = (
      await c.query(
        `SELECT s.integrity_code, s.figures->'override' AS override, s.created_at, u.name AS by
           FROM day_snapshots s JOIN users u ON u.id = s.created_by WHERE s.business_date = $1 AND s.kind = 'LOCK'`,
        [date],
      )
    ).rows[0];
    const showCash = isOwner || b.status === "LOCKED";
    const line = (label: string, v: string | null, bold?: boolean, tone?: string) => (
      <tr className={bold ? "font-semibold" : ""}>
        <td>{label}</td>
        <td className={`num ${tone ?? ""}`}>{inr(v)}</td>
      </tr>
    );
    return (
      <Page title={`Day: ${niceDate(date)}`} back="/days" active="days" wide>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
          <span>
            Status: <b>{b.status === "LOCKED" ? "Ended" : b.status === "SUBMITTED" ? "Cash counted" : "Open"}</b>
          </span>
          {snap && (
            <span className="text-muted">
              ended by {snap.by} on {new Date(snap.created_at).toLocaleString("en-IN")} · integrity code <b className="text-foreground">{snap.integrity_code}</b>
            </span>
          )}
          {snap?.override && <span className="text-orange-700">⚠ ended with reason: {snap.override.reason}</span>}
          <span className="ml-auto">
            <PrintButton />
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] [&>*]:min-w-0">
          <Panel title="Nozzle readings">
            <div className="overflow-x-auto">
              <table className="reg min-w-[32rem]">
                <thead>
                  <tr>
                    <th>Nozzle</th>
                    <th className="text-right">Opening</th>
                    <th className="text-right">Closing</th>
                    <th className="text-right">Litres</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.nozzles.map((n) => (
                    <tr key={n.nozzle_id}>
                      <td className="whitespace-nowrap">
                        <b>{n.label}</b> <span className="text-xs text-muted">{String(n.station).replace(/\s*\(.*\)/, "")}</span>
                      </td>
                      {n.closing == null ? (
                        <td colSpan={5} className="text-right text-sm text-red-700">
                          no reading
                        </td>
                      ) : (
                        <>
                          <td className="num text-muted">{num(n.opening)}</td>
                          <td className="num">{num(n.closing)}</td>
                          <td className="num">{num(n.litres)}</td>
                          <td className="num">{inr(n.rate)}</td>
                          <td className="num">
                            {inr(n.value)}
                            {!n.confirmed && <span className="ml-1 text-xs text-orange-700">prov.</span>}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {sheet.fuels.map((f) => (
                    <tr key={f.fuel} className="bg-soft text-sm">
                      <td colSpan={3}>
                        {f.short} total {!f.complete && <span className="text-red-700">(incomplete)</span>}
                      </td>
                      <td className="num">{num(f.litres)}</td>
                      <td className="num">{inr(f.rate)}</td>
                      <td className="num font-semibold">{inr(f.value)}</td>
                    </tr>
                  ))}
                </tfoot>
              </table>
            </div>
          </Panel>
          <Panel title="Day balance">
            <table className="reg">
              <tbody>
                {line("Fuel sales", b.sales.total, true)}
                {line("− Udhari given", b.udhariGiven)}
                {line("+ Udhari received (cash)", b.udhariReceivedCash)}
                {line("+ Lube / other received (cash)", b.otherInCash)}
                {line("− Paid in cash", b.paymentsCash)}
                {showCash && line("Cash that should be in hand", b.expectedCash, true)}
                {b.counted != null && line("Cash counted", b.counted, true)}
                {showCash &&
                  b.difference != null &&
                  line(
                    b.difference === "0.00" ? "Matches" : b.difference.startsWith("-") ? "Short" : "Excess",
                    b.difference.replace("-", ""),
                    true,
                    b.difference === "0.00" ? "text-green-700" : "text-red-700",
                  )}
              </tbody>
            </table>
            {(b.nonCashIn !== "0.00" || b.paymentsNonCash !== "0.00") && (
              <div className="mt-1 text-xs text-muted">
                Not in cash (UPI / bank): received {inr(b.nonCashIn)}, paid {inr(b.paymentsNonCash)}.
              </div>
            )}
          </Panel>
        </div>
        <Panel title={`Entries (${b.entries.length})`} className="mt-3">
          <table className="reg text-sm">
            <thead>
              <tr>
                <th>#</th>
                <th>Entry</th>
                <th>Mode</th>
                <th className="text-right">Amount</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {b.entries.map((e) => (
                <tr key={e.id} className={e.cancelled_reason ? "text-muted line-through" : ""}>
                  <td className="text-muted">{e.entry_no}</td>
                  <td>
                    {ENTRY_KINDS[e.kind].en}
                    {e.party && <b> · {e.party}</b>}
                    {e.expense_name && ` · ${e.expense_name}`}
                    {e.vehicle_no && <span className="text-muted"> · {e.vehicle_no}</span>}
                    {e.description && <span className="text-muted"> · {e.description}</span>}
                    {e.cancelled_reason && <span className="no-underline"> (cancelled: {e.cancelled_reason})</span>}
                  </td>
                  <td className="text-muted">{e.mode_code === "CUSTOMER_CREDIT" ? "udhari" : e.mode_code.toLowerCase()}</td>
                  <td className="num">{inr(e.amount)}</td>
                  <td className="text-muted">{e.entered_by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </Page>
    );
  } finally {
    c.release();
  }
}
