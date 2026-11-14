"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Kind = "daily" | "monthly" | "custom";
type Current = { type: Kind; from: string; to: string } | null;

const KINDS: Array<[Kind, string, string]> = [
  ["daily", "Daily", "एक दिन"],
  ["monthly", "Monthly", "महीना"],
  ["custom", "Date to date", "तारीख़ से तारीख़"],
];

/** ISO date arithmetic without time zones. */
function shift(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function prevMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * Step 1: what kind of statement (daily / monthly / date to date).
 * Step 2: only the question for that kind (which day / which month / from and to).
 */
export function PeriodChooser({ today, current }: { today: string; current: Current }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind | null>(current?.type ?? null);
  const [date, setDate] = useState(current?.type === "daily" ? current.from : today);
  const [month, setMonth] = useState(current?.type === "monthly" ? current.from.slice(0, 7) : today.slice(0, 7));
  const [from, setFrom] = useState(current?.type === "custom" ? current.from : today.slice(0, 8) + "01");
  const [to, setTo] = useState(current?.type === "custom" ? current.to : today);
  const [error, setError] = useState("");

  const show = (q: Record<string, string>) => router.push(`/statements?${new URLSearchParams(q)}`);
  const quick = "rounded border border-line bg-white px-2.5 py-1 text-sm hover:bg-soft";

  return (
    <div className="no-print mb-3 rounded border border-line bg-surface p-3">
      <div className="mb-1 text-sm font-semibold">1. Which statement? · कौन सा विवरण?</div>
      <div className="flex flex-wrap gap-2">
        {KINDS.map(([k, en, hi]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k);
              setError("");
            }}
            className={`rounded border px-4 py-1.5 font-semibold ${kind === k ? "border-brand bg-brand text-white" : "border-line bg-white hover:bg-soft"}`}
          >
            {en} <span className="text-[0.85em] font-normal opacity-75">· {hi}</span>
          </button>
        ))}
      </div>

      {kind && (
        <form
          className="mt-3 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (kind === "daily") show({ type: "daily", date });
            else if (kind === "monthly") show({ type: "monthly", month });
            else {
              if (!from || !to) return setError("Choose both dates.");
              if (from > to) return setError("'From' date is after the 'To' date.");
              show({ type: "custom", from, to });
            }
          }}
        >
          {kind === "daily" && (
            <>
              <div className="mb-1 text-sm font-semibold">2. Which day? · कौन सा दिन?</div>
              <div className="flex flex-wrap items-center gap-2">
                <input type="date" className="inp w-44" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
                <button type="button" className={quick} onClick={() => show({ type: "daily", date: today })}>
                  Today
                </button>
                <button type="button" className={quick} onClick={() => show({ type: "daily", date: shift(today, -1) })}>
                  Yesterday
                </button>
                <button className="btn">Show statement</button>
              </div>
            </>
          )}
          {kind === "monthly" && (
            <>
              <div className="mb-1 text-sm font-semibold">2. Which month? · कौन सा महीना?</div>
              <div className="flex flex-wrap items-center gap-2">
                <input type="month" className="inp w-44" value={month} max={today.slice(0, 7)} onChange={(e) => setMonth(e.target.value)} required />
                <button type="button" className={quick} onClick={() => show({ type: "monthly", month: today.slice(0, 7) })}>
                  This month
                </button>
                <button type="button" className={quick} onClick={() => show({ type: "monthly", month: prevMonth(today.slice(0, 7)) })}>
                  Last month
                </button>
                <button className="btn">Show statement</button>
              </div>
            </>
          )}
          {kind === "custom" && (
            <>
              <div className="mb-1 text-sm font-semibold">2. From which date to which date? · किस तारीख़ से किस तारीख़ तक?</div>
              <div className="flex flex-wrap items-end gap-2">
                <label>
                  <span className="block text-xs text-muted">From · से</span>
                  <input type="date" className="inp w-44" value={from} max={today} onChange={(e) => setFrom(e.target.value)} required />
                </label>
                <label>
                  <span className="block text-xs text-muted">To · तक</span>
                  <input type="date" className="inp w-44" value={to} max={today} onChange={(e) => setTo(e.target.value)} required />
                </label>
                <button className="btn">Show statement</button>
              </div>
            </>
          )}
          {error && <div className="mt-2 text-sm font-medium text-red-700">{error}</div>}
        </form>
      )}
    </div>
  );
}
