import Link from "next/link";
import { Bi, Card, Page } from "@/components/ui";
import { inr, niceDate, num } from "@/lib/format";
// (Row amounts are exact strings from the server; nothing on this page does money arithmetic.)
import { pool } from "@/server/db";
import { ENTRY_KINDS, entryDates, getDayBalance } from "@/server/money/service";
import { requireUser } from "@/server/session";
import { CancelEntry, CountForm, OwnerActions } from "./client";

export const dynamic = "force-dynamic";

export default async function CloseDayPage({ searchParams }: PageProps<"/close-day">) {
  const user = await requireUser();
  const isOwner = user.role === "OWNER";
  const sp = await searchParams;
  const c = await pool().connect();
  try {
    const dates = await entryDates(c);
    const date = isOwner && typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : (dates.yesterday ?? dates.today);
    const b = await getDayBalance(c, date);
    const snap = b.status === "LOCKED" ? (await c.query("SELECT integrity_code FROM day_snapshots WHERE business_date = $1 AND kind = 'LOCK'", [date])).rows[0] : null;
    // display only (sign / zero check); all amounts shown come from exact decimal strings
    const diff = b.difference ? Number(b.difference) : null;
    const Row = ({ en, hi, v, sign, strong }: { en: string; hi: string; v: string; sign?: string; strong?: boolean }) => (
      <div className={`flex items-baseline justify-between border-b border-line py-2 last:border-0 ${strong ? "text-xl font-bold" : "text-lg"}`}>
        <span>
          {sign && <span className="mr-1 font-mono">{sign}</span>}
          {en} <span className="text-sm font-normal opacity-70">/ {hi}</span>
        </span>
        <span className="font-mono">{inr(v)}</span>
      </div>
    );
    return (
      <Page title={<Bi en={`Day closing: ${niceDate(date)}`} hi="दिन का हिसाब बंद करें" />} back="/">
        {isOwner && (
          <form className="mb-4 flex items-center gap-2 text-base" action="/close-day">
            Other day: <input type="date" name="date" defaultValue={date} className="rounded-lg border-2 border-line bg-white px-2 py-1 text-black" />
            <button className="rounded-lg border-2 border-line px-3 py-1">Open</button>
          </form>
        )}
        <div className="mb-4 text-base">
          Status:{" "}
          <b>
            {b.status === "OPEN" ? "Open: entries allowed" : b.status === "SUBMITTED" ? "Cash counted: waiting for owner" : `🔒 Locked · code ${snap?.integrity_code ?? ""}`}
          </b>
        </div>

        {/* Blind count: staff see the expected cash only after their count is saved (owner always sees it). */}
        {!isOwner && b.status === "OPEN" ? (
          <Card className="mb-4">
            <div className="text-base">
              Count the cash first. The day&apos;s figures appear here after your count is saved.
              <div className="text-sm opacity-80">पहले नकदी गिनें। गिनती सेव होने के बाद हिसाब दिखेगा।</div>
            </div>
          </Card>
        ) : (
        <Card className="mb-4">
          {Object.entries(b.sales.byFuel).map(([fuel, f]) => (
            <Row key={fuel} en={`${fuel === "PETROL" ? "Petrol (MS)" : "Diesel (HSD)"} ${num(f.litres)} L`} hi={fuel === "PETROL" ? "पेट्रोल" : "डीज़ल"} v={f.value} />
          ))}
          <Row en="Fuel sales" hi="ईंधन बिक्री" v={b.sales.total} strong />
          <Row sign="−" en="Udhari given" hi="उधारी दी" v={b.udhariGiven} />
          <Row en="Cash sales" hi="नकद बिक्री" v={b.cashSales} strong />
          <Row sign="+" en="Udhari received in cash" hi="उधारी मिली (नकद)" v={b.udhariReceivedCash} />
          <Row sign="+" en="Lube / other received in cash" hi="अन्य आमदनी (नकद)" v={b.otherInCash} />
          <Row sign="−" en="Paid in cash" hi="नकद भुगतान" v={b.paymentsCash} />
          <Row en="Cash that should be in hand" hi="हाथ में होने चाहिए" v={b.expectedCash} strong />
          {b.nonCashIn !== "0.00" || b.paymentsNonCash !== "0.00" ? (
            <div className="mt-2 text-sm text-muted">
              Not in the drawer (UPI / bank): received {inr(b.nonCashIn)}, paid {inr(b.paymentsNonCash)}. These are already left out of the cash figure.
            </div>
          ) : null}
          {b.counted != null && (
            <>
              <Row en={`Cash counted (${b.countedBy})`} hi="गिनी गई नकदी" v={b.counted} strong />
              <div
                className={`mt-2 rounded-xl p-3 text-xl font-bold ${diff === 0 ? "bg-green-100 text-green-900" : b.withinTolerance ? "bg-yellow-100 text-yellow-900" : "bg-red-100 text-red-900"}`}
              >
                {diff === 0 ? "✅ Cash matches" : diff! < 0 ? `🔻 Short ${inr(b.difference!.replace("-", ""))} / कमी` : `🔺 Excess ${inr(b.difference!)} / ज़्यादा`}
                {diff !== 0 && b.withinTolerance && <span className="ml-2 text-sm font-normal">(small: rounding)</span>}
              </div>
            </>
          )}
        </Card>
        )}

        {b.problems.length > 0 && (
          <Card className="mb-4 border-2 border-orange-400">
            <div className="mb-1 font-bold">Before closing / बंद करने से पहले:</div>
            <ul className="list-disc pl-6 text-base">
              {b.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            {b.sales.missingReadings.length > 0 && (
              <Link href="/readings" className="mt-2 inline-block text-brand underline">
                Enter readings →
              </Link>
            )}
          </Card>
        )}

        {b.status === "OPEN" && user.permissions.includes("cash.count") && <CountForm date={date} />}
        {isOwner && b.status === "SUBMITTED" && <OwnerActions date={date} problems={b.problems.filter((p) => !p.startsWith("Cash not counted"))} />}

        <Card className="mt-4">
          <h2 className="mb-2 text-lg font-bold">
            Entries ({b.entries.length}) / प्रविष्टियाँ
          </h2>
          {b.entries.length === 0 && <div className="text-muted">No entries yet.</div>}
          <div className="space-y-1">
            {b.entries.map((e) => (
              <div key={e.id} className={`border-b border-line py-2 last:border-0 ${e.cancelled_reason ? "opacity-50" : ""}`}>
                <div className="flex justify-between gap-2 text-base">
                  <span>
                    <span className="text-sm text-muted">#{e.entry_no}</span> {ENTRY_KINDS[e.kind].en}
                    {e.party && <b> · {e.party}</b>}
                    {e.expense_name && <> · {e.expense_name}</>}
                    {e.vehicle_no && <> · {e.vehicle_no}</>}
                    {e.slip_no && <span className="text-sm text-muted"> · slip {e.slip_no}</span>}
                    {e.mode_code !== "CASH" && e.mode_code !== "CUSTOMER_CREDIT" && <span className="text-sm text-muted"> · {e.mode_code}</span>}
                  </span>
                  <span className={`font-mono ${e.cancelled_reason ? "line-through" : ""}`}>{inr(e.amount)}</span>
                </div>
                <div className="text-xs text-muted">
                  {e.entered_by_name}
                  {e.description && <> · {e.description}</>}
                  {e.cancelled_reason && <span className="text-red-600"> · CANCELLED: {e.cancelled_reason}</span>}
                </div>
                {isOwner && !e.cancelled_reason && b.status === "OPEN" && <CancelEntry entryId={e.id} />}
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
