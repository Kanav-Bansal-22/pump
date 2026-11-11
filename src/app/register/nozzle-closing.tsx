"use client";

import Decimal from "decimal.js";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Bi, Panel } from "@/components/ui";
import { apiPost, newEntryKey } from "@/lib/api-client";
import { inr, niceDate, num } from "@/lib/format";

type Row = {
  nozzleId: string;
  station: string;
  label: string;
  fuel: string;
  active: boolean;
  hasBaseline: boolean;
  done: boolean;
  lastPointId: string | null;
  lastReading: string | null;
  lastDate: string | null;
  flags: number;
};
type Result = { ok: true; status: "ACCEPTED" | "REVIEW"; note?: string } | { ok: false; message: string };

/** 8 AM next day: closing reading of all six nozzles in one table, litres and value shown as you type. */
export function NozzleClosing({ closingDate, rows, rates, locked }: { closingDate: string; rows: Row[]; rates: Record<string, string | null>; locked: boolean }) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, Result>>({});
  const [saving, setSaving] = useState(false);
  const keys = useRef<Record<string, string>>({});

  const calc = (r: Row) => {
    const v = vals[r.nozzleId];
    if (!v || !r.lastReading || !/^\d+(\.\d{1,2})?$/.test(v)) return null;
    const litres = new Decimal(v).minus(r.lastReading);
    const rate = rates[r.fuel];
    return { litres, value: rate && litres.gte(0) ? litres.times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : null };
  };
  const pending = rows.filter((r) => r.active && r.hasBaseline && !r.done && vals[r.nozzleId]);
  const totals = rows.reduce(
    (a, r) => {
      const x = calc(r);
      if (x && x.litres.gte(0)) {
        a.litres[r.fuel] = (a.litres[r.fuel] ?? new Decimal(0)).plus(x.litres);
        if (x.value) a.value = a.value.plus(x.value);
      }
      return a;
    },
    { litres: {} as Record<string, Decimal>, value: new Decimal(0) },
  );

  const saveAll = async () => {
    setSaving(true);
    const out: Record<string, Result> = { ...results };
    for (const r of pending) {
      keys.current[r.nozzleId] ??= newEntryKey();
      const res = await apiPost<{ status: "ACCEPTED" | "REVIEW"; flags: Array<{ en: string }> }>(
        "/api/readings",
        { nozzleId: r.nozzleId, reading: vals[r.nozzleId], prevPointId: r.lastPointId },
        keys.current[r.nozzleId],
      );
      if (res.ok) {
        out[r.nozzleId] = { ok: true, status: res.data.status, note: res.data.flags.map((f) => f.en).join(" ") };
        delete keys.current[r.nozzleId];
      } else {
        out[r.nozzleId] = { ok: false, message: res.error.message };
        if (res.error.code !== "NO_CONNECTION" && res.error.code !== "SERVER_ERROR") delete keys.current[r.nozzleId];
      }
      setResults({ ...out });
    }
    setSaving(false);
    router.refresh();
  };

  const missingRates = [...new Set(rows.filter((r) => r.active && !rates[r.fuel]).map((r) => r.fuel))];

  return (
    <Panel
      title={<Bi en={`Nozzle closing for ${niceDate(closingDate)}`} hi="नोज़ल क्लोज़िंग" />}
      right={`${rows.filter((r) => r.done).length}/${rows.filter((r) => r.active).length} done`}
    >
      {missingRates.length > 0 && (
        <div className="mb-2 rounded border border-orange-300 bg-orange-50 px-2 py-1 text-sm text-orange-900">
          Rate for {niceDate(closingDate)} not set for {missingRates.join(", ").toLowerCase()}: values will be missing.
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="reg min-w-[34rem]">
          <thead>
            <tr>
              <th>Nozzle</th>
              <th className="text-right">Opening</th>
              <th className="text-right">Closing</th>
              <th className="text-right">Litres</th>
              <th className="text-right">Value ₹</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const x = calc(r);
              const res = results[r.nozzleId];
              return (
                <tr key={r.nozzleId} className={r.done ? "bg-green-50/60" : ""}>
                  <td className="whitespace-nowrap">
                    <span className={`mr-1 inline-block h-2 w-2 rounded-full ${r.fuel === "PETROL" ? "bg-green-600" : "bg-blue-600"}`} />
                    <b>{r.label}</b> <span className="text-xs text-muted">{r.station.replace(/\s*\(.*\)/, "")}</span>
                  </td>
                  <td className="num text-muted">{num(r.lastReading)}</td>
                  <td className="w-36">
                    {r.done ? (
                      <span className="block text-right text-sm text-green-700">✓ saved</span>
                    ) : !r.active ? (
                      <span className="block text-right text-xs text-muted">off</span>
                    ) : !r.hasBaseline ? (
                      <span className="block text-right text-xs text-orange-700">start reading not set</span>
                    ) : (
                      <input
                        className="inp num w-full"
                        inputMode="decimal"
                        disabled={locked || saving}
                        placeholder="closing"
                        value={vals[r.nozzleId] ?? ""}
                        onChange={(e) => setVals({ ...vals, [r.nozzleId]: e.target.value.replace(/[^\d.]/g, "") })}
                        onKeyDown={(e) => e.key === "Enter" && pending.length && saveAll()}
                      />
                    )}
                  </td>
                  <td className={`num ${x && x.litres.lt(0) ? "text-red-700" : ""}`}>{x ? (x.litres.lt(0) ? "lower!" : num(x.litres.toFixed(2))) : ""}</td>
                  <td className="num">{x?.value ? inr(x.value.toFixed(2)) : ""}</td>
                  <td className="text-xs">
                    {res ? (
                      res.ok ? (
                        res.status === "ACCEPTED" ? <span className="text-green-700">✓</span> : <span className="text-orange-700" title={res.note}>⚠ review</span>
                      ) : (
                        <span className="text-red-700" title={res.message}>✗ {res.message}</span>
                      )
                    ) : r.flags > 0 ? (
                      <span className="text-orange-700">⚠ {r.flags}</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {(Object.keys(totals.litres).length > 0 || totals.value.gt(0)) && (
            <tfoot>
              <tr className="bg-soft text-sm font-semibold">
                <td colSpan={3}>
                  {Object.entries(totals.litres)
                    .map(([f, l]) => `${f === "PETROL" ? "MS" : "HSD"} ${num(l.toFixed(2))} L`)
                    .join(" · ")}
                </td>
                <td></td>
                <td className="num">{inr(totals.value.toFixed(2))}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted">Opening is filled in automatically from the last reading. Type the closing only.</span>
        <button type="button" className="btn" disabled={!pending.length || saving || locked} onClick={saveAll}>
          {saving ? "Saving…" : `Save ${pending.length || ""} reading${pending.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </Panel>
  );
}
