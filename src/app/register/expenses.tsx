"use client";

import { useState } from "react";
import { SaveStatus } from "@/components/forms";
import { Bi, Panel } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { DayChoice } from "./day-choice";

/** Expenses and other money paid out. Cash lowers the cash in hand; UPI does not touch the drawer. */
const TYPES: Array<{ v: string; label: string; kind: string; expense?: string; supplier?: boolean; owner?: boolean; cashOnly?: boolean }> = [
  { v: "milk", label: "Tea / milk", kind: "EXPENSE", expense: "6400" },
  { v: "misc", label: "Other expense", kind: "EXPENSE", expense: "6500" },
  { v: "repair", label: "Repairs", kind: "EXPENSE", expense: "6300" },
  { v: "elec", label: "Electricity", kind: "EXPENSE", expense: "6200" },
  { v: "salary", label: "Salary", kind: "SALARY", owner: true },
  { v: "supplier", label: "Paid to HPCL / supplier", kind: "SUPPLIER_PAYMENT", supplier: true },
  { v: "bank", label: "Cash deposited in bank", kind: "BANK_DEPOSIT", cashOnly: true },
  { v: "drawing", label: "Taken by owner", kind: "OWNER_DRAWING", owner: true },
];

export function Expenses({ dates, isOwner }: { dates: { today: string; yesterday: string | null }; isOwner: boolean }) {
  const { state, run, setState } = useAction<{ entryNo: string }>("/api/entries");
  const types = TYPES.filter((t) => isOwner || !t.owner);
  const [v, setV] = useState(types[0].v);
  const t = types.find((x) => x.v === v)!;
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [supplier, setSupplier] = useState("HPCL");
  const [mode, setMode] = useState<"" | "CASH" | "UPI">("");
  const [day, setDay] = useState(dates.yesterday ? "" : dates.today);
  const paidBy = t.cashOnly ? "CASH" : mode;
  return (
    <Panel title={<Bi en="Expenses / payments" hi="खर्च / भुगतान" />}>
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!day) return setState({ kind: "error", message: "Choose the day." });
          if (!paidBy) return setState({ kind: "error", message: "Was it paid in Cash or by UPI? Choose one.", messageHi: "नकद या UPI चुनें।" });
          const r = await run(
            { kind: t.kind, businessDate: day, expenseCode: t.expense ?? null, party: t.supplier ? { name: supplier } : null, amount, mode: paidBy, description: desc || null },
            `${t.label}: ₹${amount} paid by ${paidBy === "CASH" ? "cash" : "UPI"}.`,
          );
          if (r) {
            setAmount("");
            setDesc("");
            setMode("");
          }
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <select className="inp w-52" value={v} onChange={(e) => setV(e.target.value)}>
            {types.map((x) => (
              <option key={x.v} value={x.v}>
                {x.label}
              </option>
            ))}
          </select>
          {t.supplier && <input className="inp w-28" placeholder="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />}
          <input className="inp num w-28" inputMode="decimal" placeholder="Amount ₹" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} />
          {t.cashOnly ? (
            <span className="text-sm text-muted">from cash</span>
          ) : (
            <div className="flex overflow-hidden rounded border border-line" role="radiogroup" aria-label="Paid by">
              {(["CASH", "UPI"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={`h-[2.1rem] px-3 text-sm font-semibold ${mode === m ? "bg-accent text-white" : "bg-white"}`}
                >
                  {m === "CASH" ? "Cash · नकद" : "UPI"}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <input className="inp min-w-32 flex-1" placeholder="Details (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <DayChoice dates={dates} value={day} onChange={setDay} />
          <button className="btn" disabled={!amount || state.kind === "saving"}>
            {state.kind === "saving" ? "Saving…" : "Save"}
          </button>
        </div>
        <div className="text-xs text-muted">Paid in cash = less cash in hand at day end. Paid by UPI = cash in hand not affected.</div>
      </form>
      <SaveStatus state={state} />
    </Panel>
  );
}
