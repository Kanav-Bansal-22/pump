"use client";

import { useState } from "react";
import { SaveStatus } from "@/components/forms";
import { Card } from "@/components/ui";
import { useAction } from "@/components/use-action";

export function CountForm({ date }: { date: string }) {
  const { state, run } = useAction("/api/day");
  const [counted, setCounted] = useState("");
  return (
    <Card className="border-2 border-brand">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run({ action: "count", date, counted }, "Cash count saved and day submitted to the owner. / गिनती सेव, मालिक को भेजा।");
        }}
      >
        <label className="block">
          <span className="mb-1 block text-lg font-semibold">
            Count all the cash and type the total
            <br />
            <span className="text-base font-normal opacity-80">सारी नकदी गिनकर कुल लिखें</span>
          </span>
          <input
            inputMode="decimal"
            value={counted}
            onChange={(e) => setCounted(e.target.value.replace(/[^\d.,]/g, ""))}
            className="w-full rounded-xl border-2 border-line bg-white px-4 py-4 text-center font-mono text-3xl text-black"
            placeholder="0"
          />
        </label>
        <button type="submit" disabled={!counted || state.kind === "saving"} className="mt-3 w-full rounded-2xl bg-green-700 px-4 py-4 text-xl font-bold text-white disabled:opacity-50">
          {state.kind === "saving" ? "⏳ Saving…" : "Save count & submit / सेव करें"}
        </button>
        <SaveStatus state={state} />
      </form>
    </Card>
  );
}

export function OwnerActions({ date, problems }: { date: string; problems: string[] }) {
  const lock = useAction<{ integrityCode: string }>("/api/day");
  const back = useAction("/api/day");
  const [reason, setReason] = useState("");
  return (
    <Card className="border-2 border-green-700">
      <h2 className="mb-2 text-lg font-bold">Owner: lock the day / दिन बंद करें</h2>
      <p className="mb-3 text-base">
        Locking posts the day&apos;s sales and cash into the books. After locking nothing for this day can be added or changed.
      </p>
      {problems.length > 0 && (
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason to lock anyway (required because of the problems above)"
          className="mb-3 w-full rounded-xl border-2 border-orange-400 bg-white px-3 py-3 text-base text-black"
        />
      )}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={back.state.kind === "saving"}
          onClick={() => back.run({ action: "reopen", date }, "Day sent back. Staff can fix entries and count again.")}
          className="rounded-2xl border-2 border-line px-3 py-4 text-lg"
        >
          Send back for recount
        </button>
        <button
          type="button"
          disabled={lock.state.kind === "saving"}
          onClick={() => lock.run({ action: "lock", date, overrideReason: reason || null }, "Day locked.")}
          className="rounded-2xl bg-green-700 px-3 py-4 text-lg font-bold text-white"
        >
          {lock.state.kind === "saving" ? "⏳ Locking…" : "🔒 Lock day"}
        </button>
      </div>
      <SaveStatus state={lock.state.kind !== "idle" ? lock.state : back.state} />
    </Card>
  );
}

export function CancelEntry({ entryId }: { entryId: string }) {
  const { state, run } = useAction("/api/day");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-1 text-sm text-red-700 underline">
        Cancel this entry
      </button>
    );
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. typed wrong amount" className="min-w-0 flex-1 rounded-lg border-2 border-line bg-white px-3 py-2 text-base text-black" />
      <button type="button" disabled={state.kind === "saving"} onClick={() => run({ action: "cancelEntry", entryId, reason }, "Entry cancelled.")} className="rounded-lg bg-red-700 px-3 py-2 text-white">
        Cancel entry
      </button>
      <div className="w-full">
        <SaveStatus state={state} />
      </div>
    </div>
  );
}
