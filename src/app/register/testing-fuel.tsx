"use client";

import { useState } from "react";
import { SaveStatus } from "@/components/forms";
import { Bi, Panel } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { num } from "@/lib/format";
import type { OpenTest } from "@/server/meters/service";

type Nozzle = { id: string; label: string; station: string };
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** Testing fuel: litres drawn to check a nozzle. Taken off that nozzle's sales at the next closing. */
export function TestingFuel({ nozzles, tests }: { nozzles: Nozzle[]; tests: OpenTest[] }) {
  const [nozzleId, setNozzleId] = useState("");
  const [litres, setLitres] = useState("5");
  const [returned, setReturned] = useState(true);
  const [reason, setReason] = useState("");
  const save = useAction<{ label: string; litres: string }>("/api/tests");
  const cancel = useAction<{ cancelled: string }>("/api/tests");

  return (
    <Panel title={<Bi en="Testing fuel" hi="टेस्टिंग" />} right={<span className="text-xs">not a sale: comes off the next closing</span>}>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          cancel.setState({ kind: "idle" });
          if (!nozzleId) return save.setState({ kind: "error", message: "Choose the nozzle." });
          save.run(
            { action: "record", nozzleId, litres, returned, reason: returned ? null : reason },
            (d) => `Test ${num(d.litres)} L on ${d.label} saved${returned ? " (put back in tank)" : ""}.`,
            () => {
              setReason("");
              setReturned(true);
            },
          );
        }}
      >
        <select className="inp w-48" value={nozzleId} onChange={(e) => setNozzleId(e.target.value)}>
          <option value="">Nozzle…</option>
          {nozzles.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label} · {n.station}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          <input className="inp num w-20" inputMode="decimal" value={litres} onChange={(e) => setLitres(e.target.value.replace(/[^\d.]/g, ""))} />
          <span className="text-sm">L</span>
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={returned} onChange={(e) => setReturned(e.target.checked)} />
          Put back in tank
        </label>
        {!returned && <input className="inp min-w-40 flex-1" placeholder="Why not put back? (e.g. sample)" value={reason} onChange={(e) => setReason(e.target.value)} />}
        <button className="btn" disabled={!litres || save.state.kind === "saving"}>
          {save.state.kind === "saving" ? "Saving…" : "Save test"}
        </button>
      </form>
      <SaveStatus state={save.state} />
      <SaveStatus state={cancel.state} />

      {tests.length > 0 && (
        <table className="reg mt-2 text-sm">
          <tbody>
            {tests.map((t) => (
              <tr key={t.id} className={t.voided ? "text-muted line-through" : ""}>
                <td className="text-xs text-muted">{time(t.at)}</td>
                <td>
                  {t.label} <span className="text-xs text-muted">· {t.station} · {t.by}</span>
                  {!t.returned && <div className="text-xs text-orange-800">not put back: {t.reason}</div>}
                </td>
                <td className="num">{num(t.litres)} L</td>
                <td className="w-14 text-right">
                  {!t.voided && (
                    <button
                      type="button"
                      className="text-xs text-red-700 underline"
                      disabled={cancel.state.kind === "saving"}
                      onClick={() => {
                        save.setState({ kind: "idle" });
                        const why = prompt(`Cancel test ${num(t.litres)} L on ${t.label}? Write why (e.g. typed by mistake):`);
                        if (why != null) cancel.run({ action: "void", testId: t.id, reason: why }, (d) => `Test of ${num(d.cancelled)} L cancelled.`);
                      }}
                    >
                      wrong
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
