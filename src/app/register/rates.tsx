"use client";

import { useState } from "react";
import { SaveStatus } from "@/components/forms";
import { Bi, Panel } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { inr, niceDate } from "@/lib/format";

type R = { code: string; short: string; name: string; rate: string | null; setBy: string | null };

/** 8 AM: today's petrol and diesel rates. */
export function Rates({ date, rates, canSet }: { date: string; rates: R[]; canSet: boolean }) {
  const { state, run } = useAction("/api/owner/meters");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const allSet = rates.every((r) => r.rate);
  const changing = rates.filter((r) => vals[r.code] && vals[r.code] !== r.rate);
  const needReason = changing.some((r) => r.rate);

  const save = async () => {
    for (const r of changing) {
      const ok = await run({ action: "setRate", fuelCode: r.code, rate: vals[r.code], reason: r.rate ? reason : null }, "Rates saved.");
      if (ok === null) return;
    }
    setVals({});
    setReason("");
  };

  return (
    <Panel
      title={<Bi en={`Rates for ${niceDate(date)}`} hi="आज का रेट" />}
      right={allSet ? "✓ set" : <span className="font-semibold text-red-700">not set</span>}
    >
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {rates.map((r) => (
          <label key={r.code} className="w-32">
            <span className="block text-xs text-muted">
              {r.name} ({r.short}) ₹/L
            </span>
            <input
              className="inp num w-full"
              inputMode="decimal"
              disabled={!canSet}
              placeholder={r.rate ?? "0.00"}
              value={vals[r.code] ?? (r.rate ?? "")}
              onChange={(e) => setVals({ ...vals, [r.code]: e.target.value.replace(/[^\d.]/g, "") })}
            />
          </label>
        ))}
        {needReason && <input className="inp min-w-40 flex-1" placeholder="Reason for changing the rate" value={reason} onChange={(e) => setReason(e.target.value)} />}
        {canSet && (
          <button className="btn" disabled={!changing.length || state.kind === "saving"}>
            {state.kind === "saving" ? "Saving…" : "Save rates"}
          </button>
        )}
      </form>
      {allSet && changing.length === 0 && (
        <div className="mt-1 text-xs text-muted">
          {rates.map((r) => `${r.short} ${inr(r.rate)}`).join(" · ")} · set by {rates[0]?.setBy}
        </div>
      )}
      <SaveStatus state={state} />
    </Panel>
  );
}
