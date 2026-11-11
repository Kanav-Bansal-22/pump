"use client";

import { useState } from "react";
import { SaveStatus } from "@/components/forms";
import { Bi, Panel } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { inr } from "@/lib/format";

type Hist = Array<{ amount: string; at: string }>;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** The employee types the NET UPI total received so far (from the QR app), not each payment. Latest figure counts. */
export function MyUpi({ date, history }: { date: string; history: Hist }) {
  const [amount, setAmount] = useState("");
  const { state, run, setState } = useAction<{ amount: string; history: Hist }>("/api/my-upi");
  const current = history[0];
  return (
    <Panel title={<Bi en="My UPI today" hi="मेरा आज का UPI" />}>
      <div className="mb-2 text-sm">
        {current ? (
          <>
            Your total now: <b className="num text-base">{inr(current.amount)}</b> <span className="text-muted">(at {time(current.at)})</span>
          </>
        ) : (
          <span className="text-muted">Nothing given yet today.</span>
        )}
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!amount) return setState({ kind: "error", message: "Type your total UPI received so far." });
          run({ amount, businessDate: date }, (d) => `Your UPI total is now ${inr(d.amount)}.`, () => setAmount(""));
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="mb-0.5 block text-xs text-muted">Total UPI received by me so far today · अब तक कुल</span>
          <input className="inp num w-full" inputMode="decimal" placeholder="e.g. 12500" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} />
        </label>
        <button className="btn" disabled={!amount || state.kind === "saving"}>
          {state.kind === "saving" ? "Saving…" : "Save total"}
        </button>
      </form>
      <SaveStatus state={state} />
      <p className="mt-1.5 text-xs text-muted">Type the full total, not just the new payment. A new total replaces the old one.</p>
      {history.length > 1 && (
        <div className="mt-2 text-xs text-muted">
          Earlier today: {history.slice(1, 6).map((h) => `${inr(h.amount)} (${time(h.at)})`).join(" · ")}
        </div>
      )}
    </Panel>
  );
}
