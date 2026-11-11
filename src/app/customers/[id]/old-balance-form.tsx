"use client";

import { useState } from "react";
import { SaveStatus } from "@/components/forms";
import { Card } from "@/components/ui";
import { useAction } from "@/components/use-action";

/** Owner: add this one customer's balance from the old register (allowed once per customer). */
export function OldBalanceForm({ partyId, today }: { partyId: string; today: string }) {
  const { state, run } = useAction("/api/owner/import");
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [date, setDate] = useState(today);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-4 rounded border border-dashed border-brand px-3 py-1.5 text-base print:hidden">
        + Add old balance from the register / पुराना बकाया जोड़ें
      </button>
    );
  return (
    <Card className="mt-4 print:hidden">
      <div className="space-y-3">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount they owe (−500 for an advance)"
          className="inp w-full"
        />
        <label className="block text-base">
          As on <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="ml-2 rounded-lg border border-line bg-white px-2 py-1 text-black" />
        </label>
        <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Remarks (optional), e.g. register page 12" className="inp w-full" />
        <button
          type="button"
          disabled={!amount || state.kind === "saving"}
          onClick={() => run({ action: "single", partyId, amount, date, remarks: remarks || null }, "Old balance added. / पुराना बकाया जुड़ गया।")}
          className="w-full rounded bg-green-700 px-3 py-1.5 text-lg font-bold text-white disabled:opacity-50"
        >
          Save old balance
        </button>
        <SaveStatus state={state} />
      </div>
    </Card>
  );
}
