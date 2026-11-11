import { Bi, Card, Page } from "@/components/ui";
import { inr, niceDate, num } from "@/lib/format";
import { pool } from "@/server/db";
import { closingBusinessDate, getDaySheet, listOpenFlags } from "@/server/meters/service";
import { requireUser } from "@/server/session";
import { DatePicker, ReviewForm } from "./client";

export const dynamic = "force-dynamic";

/** The right-hand page of the Rokad: readings, litres, rate, sales value, per day. */
export default async function DaySheetPage({ searchParams }: PageProps<"/owner/day">) {
  await requireUser("report.financial");
  const sp = await searchParams;
  const c = await pool().connect();
  try {
    const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : await closingBusinessDate(c);
    const sheet = await getDaySheet(c, date);
    const flags = await listOpenFlags(c);
    return (
      <Page title={<Bi en="Day sheet: fuel sales" hi="दिन का हिसाब: बिक्री" />} back="/">
        <DatePicker date={date} />
        <Card className="mb-4 overflow-x-auto">
          <h2 className="mb-2 text-lg font-bold">{niceDate(date)}</h2>
          <table className="w-full min-w-[34rem] text-base">
            <thead>
              <tr className="border-b border-line text-left text-sm text-muted">
                <th className="py-1">Nozzle</th>
                <th className="py-1 text-right">Closing</th>
                <th className="py-1 text-right">Opening</th>
                <th className="py-1 text-right">Litres</th>
                <th className="py-1 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {sheet.nozzles.map((n) => (
                <tr key={n.nozzle_id} className="border-b border-line last:border-0">
                  <td className="py-2">
                    <div className="font-semibold">{n.label}</div>
                    <div className="text-xs text-muted">{n.station}</div>
                  </td>
                  {n.closing == null ? (
                    <td colSpan={4} className="py-2 text-right font-semibold text-red-600">
                      🔴 Reading missing / रीडिंग नहीं
                    </td>
                  ) : (
                    <>
                      <td className="py-2 text-right font-mono">{num(n.closing)}</td>
                      <td className="py-2 text-right font-mono text-muted">{num(n.opening)}</td>
                      <td className="py-2 text-right font-mono">
                        {num(n.litres)}
                        {(n.tests_returned !== "0.000" || n.tests_not_returned !== "0.000") && (
                          <div className="text-xs text-muted">
                            tests {num(n.tests_returned)} back, {num(n.tests_not_returned)} not back
                          </div>
                        )}
                      </td>
                      <td className="py-2 text-right font-mono">
                        {n.value ? inr(n.value) : <span className="text-orange-600">no rate</span>}
                        {!n.confirmed && <div className="text-xs text-orange-600">🟡 provisional</div>}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="mb-4">
          <h2 className="mb-2 text-lg font-bold">Totals (like the register) / कुल</h2>
          {sheet.fuels.map((f) => (
            <div key={f.fuel} className="flex flex-wrap justify-between border-b border-line py-2 text-lg last:border-0">
              <span>
                {f.short}: <span className="font-mono">{num(f.litres)}</span> L × {f.rate ? inr(f.rate) : "no rate"}
                {!f.complete && <span className="ml-2 text-sm text-red-600">(readings missing)</span>}
              </span>
              <span className="font-mono font-bold">{inr(f.value)}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between text-xl font-bold">
            <span>Fuel sales / ईंधन बिक्री</span>
            <span className="font-mono">{inr(sheet.total)}</span>
          </div>
          {sheet.fuels.some((f) => f.provisionalValue !== "0.00") && (
            <div className="mt-1 text-sm text-orange-600">Includes provisional amounts waiting for your review (below).</div>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 text-lg font-bold">
            Waiting for your review / आपकी जाँच बाकी ({flags.length})
          </h2>
          {flags.length === 0 && <div className="text-base text-muted">Nothing waiting. ✅</div>}
          <div className="space-y-3">
            {flags.map((f) => (
              <div key={f.id} className="rounded-xl border border-line p-3">
                <div className="font-semibold">
                  {f.station} · {f.label} · {niceDate(f.date)}
                </div>
                <div className="text-base">🟡 {f.text.en}</div>
                <div className="text-sm text-muted">
                  Reading {num(f.reading)} by {f.entered_by}
                </div>
                <ReviewForm flagId={f.id} zero={f.code === "ZERO_THROUGHPUT"} />
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
