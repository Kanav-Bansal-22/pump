"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SaveStatus } from "@/components/forms";
import { Card } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { inr } from "@/lib/format";

/**
 * Owner: remove this udhari customer. Their old (imported) balance is cancelled and they disappear from
 * every list; nothing is erased (the record stays in the books). Refused while later entries leave a balance.
 */
export function RemoveCustomer({ partyId, name, opening, balance }: { partyId: string; name: string; opening: string | null; balance: string }) {
  const router = useRouter();
  const { state, run } = useAction<{ name: string; openingCancelled: string }>("/api/customers/remove");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-4 rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 print:hidden">
        Remove this customer · ग्राहक हटाएँ
      </button>
    );
  return (
    <Card className="mt-4 border-red-300 print:hidden">
      <h2 className="mb-1 text-lg font-bold text-red-800">Remove {name}?</h2>
      <ul className="mb-2 list-disc pl-5 text-sm">
        {opening && opening !== "0.00" && (
          <li>
            The old balance of <b>{opening.startsWith("-") ? `advance ${inr(opening.slice(1))}` : inr(opening)}</b> will be cancelled.
          </li>
        )}
        <li>They disappear from the customer list, udhari search, print-all and statements.</li>
        <li>Nothing is erased: the record stays in the books, marked removed.</li>
        {balance !== (opening ?? "0.00") && (
          <li className="text-orange-800">They also have later udhari entries; cancel those in the day book first, or this will be refused.</li>
        )}
      </ul>
      <input className="inp mb-2 w-full" placeholder="Reason, e.g. added twice / test entry / same as NAVDEEP DUGAAT" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded bg-red-700 px-3 py-1.5 font-bold text-white disabled:opacity-50"
          disabled={reason.trim().length < 5 || state.kind === "saving"}
          onClick={() =>
            run({ partyId, reason }, (d) => `${d.name} removed.`, () => {
              setTimeout(() => router.push("/customers"), 1200);
            })
          }
        >
          {state.kind === "saving" ? "Removing…" : "Remove"}
        </button>
        <button type="button" className="btn-light" onClick={() => setOpen(false)}>
          Keep
        </button>
      </div>
      <SaveStatus state={state} />
    </Card>
  );
}
