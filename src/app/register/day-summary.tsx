"use client";

import Link from "next/link";
import { useState } from "react";
import { SaveStatus } from "@/components/forms";
import { Bi, Panel } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { inr, niceDate, num } from "@/lib/format";
import type { DayBalance } from "@/server/money/service";

type Summary = Omit<DayBalance, "_site" | "_fuel">;

function Row({ label, v, sign, bold, tone }: { label: string; v: string | null; sign?: string; bold?: boolean; tone?: string }) {
  return (
    <tr className={bold ? "font-semibold" : ""}>
      <td className="w-5 text-muted">{sign}</td>
      <td>{label}</td>
      <td className={`num ${tone ?? ""}`}>{v == null ? "" : inr(v)}</td>
    </tr>
  );
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** UPI totals reported from the employees' phones, checked against the one QR's app total typed at End day. */
function UpiByStaff({ s }: { s: Summary }) {
  const chk = s.upiCheck!;
  const d = chk.difference;
  return (
    <div className="mt-2 rounded border border-line">
      <div className="bg-soft px-2 py-1 text-xs font-semibold">UPI by employee · कर्मचारी UPI</div>
      <table className="reg text-sm">
        <tbody>
          {s.staffUpi.map((u) => (
            <tr key={u.userId}>
              <td>{u.name}</td>
              <td className="text-xs text-muted">at {hhmm(u.at)}</td>
              <td className="num">{inr(u.amount)}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td colSpan={2}>Total reported by staff</td>
            <td className="num">{inr(chk.staff)}</td>
          </tr>
          {chk.paytm != null && (
            <tr className="font-semibold">
              <td colSpan={2}>QR app total (typed at End day)</td>
              <td className="num">{inr(chk.paytm)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <div
        className={`px-2 py-1 text-sm font-medium ${d == null ? "text-muted" : d === "0.00" ? "text-green-700" : "bg-orange-50 text-orange-900"}`}
      >
        {d == null
          ? "Check: type the QR app's total for the day in the UPI box below."
          : d === "0.00"
            ? "✓ QR app total matches what staff reported."
            : d.startsWith("-")
              ? `⚠ Staff reported ${inr(d.slice(1))} MORE than the QR app shows. Check each person's figure.`
              : `⚠ QR app shows ${inr(d)} more than staff reported (someone did not update). The app total is what counts.`}
      </div>
    </div>
  );
}

/** The day's balance in the register's order, and the End day button. */
export function DaySummary({ summary: s, isOwner, integrityCode }: { summary: Summary; isOwner: boolean; integrityCode: string | null }) {
  const { state, run, setState } = useAction<{ difference: string | null; integrityCode: string }>("/api/day");
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [needReason, setNeedReason] = useState(false);
  const totals = useAction("/api/day");
  const [modes, setModes] = useState<Record<string, string>>({});
  // only the boxes actually typed in are sent; empty boxes keep the saved total
  const typed = () => Object.fromEntries(Object.entries(modes).filter(([, v]) => v.trim() !== ""));
  const ended = s.status === "LOCKED";
  const showCash = isOwner || ended; // blind count: staff see the expected cash only after the day is ended
  const diff = s.difference;

  return (
    <Panel
      title={<Bi en={`Day summary ${niceDate(s.date)}`} hi="दिन का हिसाब" />}
      right={ended ? <span className="font-semibold text-green-700">✓ ended {integrityCode && `· ${integrityCode}`}</span> : s.status === "SUBMITTED" ? "cash counted" : "open"}
    >
      <table className="reg">
        <tbody>
          {Object.entries(s.sales.byFuel).map(([f, x]) => (
            <Row key={f} label={`${f === "PETROL" ? "Petrol (MS)" : "Diesel (HSD)"}: ${num(x.litres)} L`} v={x.value} />
          ))}
          <Row label="Fuel sales" v={s.sales.total} bold />
          <Row sign="−" label="Udhari given" v={s.udhariGiven} />
          {s.collections
            .filter((x) => x.total != null)
            .map((x) => (
              <tr key={x.mode}>
                <td className="w-5 text-muted">−</td>
                <td>
                  Fuel sold by {x.label}
                  <div className="text-xs text-muted">
                    {x.label} total {inr(x.total)}
                    {x.source === "staff" && " (as reported by staff)"}
                    {x.alreadyEntered !== "0.00" && <> − udhari / other by {x.label} {inr(x.alreadyEntered)}</>}
                  </div>
                </td>
                <td className={`num ${x.sales.startsWith("-") ? "text-red-700" : ""}`}>{inr(x.sales)}</td>
              </tr>
            ))}
          <Row label="Cash sales" v={s.cashSales} bold />
          <Row sign="+" label="Udhari received (cash)" v={s.udhariReceivedCash} />
          <Row sign="+" label="Lube / other received (cash)" v={s.otherInCash} />
          <Row sign="−" label="Expenses paid in cash" v={s.paymentsCash} />
          {showCash ? (
            <Row label="Cash that should be in hand" v={s.expectedCash} bold />
          ) : (
            <tr>
              <td></td>
              <td colSpan={2} className="text-xs text-muted">
                Cash that should be in hand: shown after End day (count first)
              </td>
            </tr>
          )}
          {s.counted != null && showCash && <Row label={`Cash counted (${s.countedBy})`} v={s.counted} bold />}
          {diff != null && showCash && (
            <Row
              label={diff === "0.00" ? "Matches ✓" : diff.startsWith("-") ? "Short" : "Excess"}
              v={diff.replace("-", "")}
              bold
              tone={diff === "0.00" ? "text-green-700" : diff.startsWith("-") ? "text-red-700" : "text-orange-700"}
            />
          )}
        </tbody>
      </table>
      {(s.nonCashIn !== "0.00" || s.paymentsNonCash !== "0.00") && (
        <div className="mt-1 text-xs text-muted">
          Not in the cash drawer: received by UPI / card / bank {inr(s.nonCashIn)}, expenses paid by UPI / bank {inr(s.paymentsNonCash)}.
        </div>
      )}

      {s.upiCheck && <UpiByStaff s={s} />}

      {!ended && s.problems.filter((p) => !p.startsWith("Cash not counted")).length > 0 && (
        <ul className="mt-2 list-disc rounded border border-orange-300 bg-orange-50 py-1 pl-6 pr-2 text-sm text-orange-900">
          {s.problems
            .filter((p) => !p.startsWith("Cash not counted"))
            .map((p) => (
              <li key={p}>{p}</li>
            ))}
        </ul>
      )}

      {!ended ? (
        <form
          className="mt-3 border-t border-line pt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(
              { action: "endDay", date: s.date, counted, overrideReason: needReason ? reason : null, collections: typed() },
              "Day ended and saved in Daily records.",
            );
            if (!r) setNeedReason(isOwner);
          }}
        >
          <div className="mb-1 text-xs font-semibold text-muted">
            Money received by other modes today (total shown on each machine / app) · UPI / कार्ड / बैंक
          </div>
          <div className="mb-2 flex flex-wrap items-end gap-2">
            {s.collections.map((x) => (
              <label key={x.mode} className="w-28">
                <span className="block text-xs text-muted">{x.label} ₹</span>
                <input
                  className="inp num w-full"
                  inputMode="decimal"
                  placeholder={x.total ?? "0"}
                  value={modes[x.mode] ?? ""}
                  onChange={(e) => setModes({ ...modes, [x.mode]: e.target.value.replace(/[^\d.,]/g, "") })}
                />
              </label>
            ))}
            <button
              type="button"
              className="btn-light"
              disabled={!Object.values(modes).some((v) => v) || totals.state.kind === "saving"}
              onClick={async () => {
                if (await totals.run({ action: "collections", date: s.date, amounts: typed() }, "Totals saved.")) setModes({});
              }}
            >
              Save totals
            </button>
          </div>
          <SaveStatus state={totals.state} />
          <div className="flex flex-wrap items-end gap-2">
          <label className="w-40">
            <span className="block text-xs text-muted">Cash counted ₹ · गिनी नकदी</span>
            <input className="inp num w-full" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0" />
          </label>
          {needReason && (
            <input className="inp min-w-48 flex-1" placeholder="Owner: reason to end anyway" value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
          <button
            className="btn btn-ok"
            disabled={!counted || state.kind === "saving"}
            onClick={() => state.kind === "error" && setState({ kind: "idle" })}
          >
            {state.kind === "saving" ? "Ending…" : `End day ${niceDate(s.date)}`}
          </button>
          </div>
        </form>
      ) : (
        <div className="mt-2 text-sm">
          Saved in{" "}
          <Link href={`/days/${s.date}`} className="text-accent underline">
            Daily records →
          </Link>
        </div>
      )}
      <SaveStatus state={state} />
    </Panel>
  );
}
