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

/** The day's balance in the register's order, and the End day button. */
export function DaySummary({ summary: s, isOwner, integrityCode }: { summary: Summary; isOwner: boolean; integrityCode: string | null }) {
  const { state, run, setState } = useAction<{ difference: string | null; integrityCode: string }>("/api/day");
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [needReason, setNeedReason] = useState(false);
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
          <Row sign="+" label="Udhari received (cash)" v={s.udhariReceivedCash} />
          <Row sign="+" label="Lube / other received (cash)" v={s.otherInCash} />
          <Row sign="−" label="Paid in cash" v={s.paymentsCash} />
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
          Not in cash (UPI / bank): received {inr(s.nonCashIn)}, paid {inr(s.paymentsNonCash)}.
        </div>
      )}

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
          className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run({ action: "endDay", date: s.date, counted, overrideReason: needReason ? reason : null }, "Day ended and saved in Daily records.");
            if (!r) setNeedReason(isOwner);
          }}
        >
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
