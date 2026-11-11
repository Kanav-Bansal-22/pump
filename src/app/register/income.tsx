"use client";

import { useState } from "react";
import { SaveStatus } from "@/components/forms";
import { Bi, Panel } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { DayChoice } from "./day-choice";

/** Lubricant sales and other money received. Only cash adds to the cash in hand. */
const TYPES = [
  { v: "lube", label: "Lubricant sale", kind: "LUBE_SALE" },
  { v: "income", label: "Other income", kind: "OTHER_INCOME" },
] as const;
const MODES = [
  ["CASH", "Cash · नकद"],
  ["UPI", "UPI"],
  ["DEBIT_CARD", "Card"],
] as const;

export function Income({ dates }: { dates: { today: string; yesterday: string | null } }) {
  const { state, run, setState } = useAction<{ entryNo: string }>("/api/entries");
  const [v, setV] = useState<(typeof TYPES)[number]["v"]>("lube");
  const t = TYPES.find((x) => x.v === v)!;
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [mode, setMode] = useState<string>("");
  const [day, setDay] = useState(dates.yesterday ? "" : dates.today);
  return (
    <Panel title={<Bi en="Lube / other income" hi="लुब्रिकेंट / अन्य आमदनी" />}>
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!day) return setState({ kind: "error", message: "Choose the day." });
          if (!mode) return setState({ kind: "error", message: "Received in Cash, UPI or Card? Choose one.", messageHi: "नकद, UPI या कार्ड चुनें।" });
          const r = await run(
            { kind: t.kind, businessDate: day, amount, mode, description: desc || null },
            `${t.label}: ₹${amount} received by ${MODES.find((m) => m[0] === mode)![1].split(" ")[0]}.`,
          );
          if (r) {
            setAmount("");
            setDesc("");
            setMode("");
          }
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <select className="inp w-40" value={v} onChange={(e) => setV(e.target.value as typeof v)}>
            {TYPES.map((x) => (
              <option key={x.v} value={x.v}>
                {x.label}
              </option>
            ))}
          </select>
          <input className="inp num w-28" inputMode="decimal" placeholder="Amount ₹" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} />
          <div className="flex overflow-hidden rounded border border-line" role="radiogroup" aria-label="Received by">
            {MODES.map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`h-[2.1rem] px-3 text-sm font-semibold ${mode === m ? "bg-accent text-white" : "bg-white"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <input className="inp min-w-32 flex-1" placeholder="Details (optional), e.g. 2T oil 1 L" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <DayChoice dates={dates} value={day} onChange={setDay} />
          <button className="btn" disabled={!amount || state.kind === "saving"}>
            {state.kind === "saving" ? "Saving…" : "Save"}
          </button>
        </div>
        <div className="text-xs text-muted">Only cash adds to cash in hand. UPI / card money is part of the day&apos;s UPI / card machine total.</div>
      </form>
      <SaveStatus state={state} />
    </Panel>
  );
}
