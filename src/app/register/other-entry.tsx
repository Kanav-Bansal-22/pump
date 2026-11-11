"use client";

import { useState } from "react";
import { SaveStatus } from "@/components/forms";
import { Bi, Panel } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { DayChoice } from "./day-choice";

/** Everything else in the Rokad that is not udhari: expenses, HPCL, bank deposit, lube sales ... */
const TYPES: Array<{ v: string; label: string; kind: string; expense?: string; supplier?: boolean; dir: "IN" | "OUT"; owner?: boolean }> = [
  { v: "milk", label: "Tea / milk (paid)", kind: "EXPENSE", expense: "6400", dir: "OUT" },
  { v: "misc", label: "Other expense (paid)", kind: "EXPENSE", expense: "6500", dir: "OUT" },
  { v: "repair", label: "Repairs (paid)", kind: "EXPENSE", expense: "6300", dir: "OUT" },
  { v: "elec", label: "Electricity (paid)", kind: "EXPENSE", expense: "6200", dir: "OUT" },
  { v: "salary", label: "Salary (paid)", kind: "SALARY", dir: "OUT", owner: true },
  { v: "supplier", label: "Paid to HPCL / supplier", kind: "SUPPLIER_PAYMENT", supplier: true, dir: "OUT" },
  { v: "bank", label: "Cash deposited in bank", kind: "BANK_DEPOSIT", dir: "OUT" },
  { v: "drawing", label: "Taken by owner", kind: "OWNER_DRAWING", dir: "OUT", owner: true },
  { v: "lube", label: "Lubricant sale (received)", kind: "LUBE_SALE", dir: "IN" },
  { v: "income", label: "Other income (received)", kind: "OTHER_INCOME", dir: "IN" },
];

export function OtherEntry({ dates, isOwner }: { dates: { today: string; yesterday: string | null }; isOwner: boolean }) {
  const { state, run, setState } = useAction<{ entryNo: string }>("/api/entries");
  const types = TYPES.filter((t) => isOwner || !t.owner);
  const [v, setV] = useState(types[0].v);
  const t = types.find((x) => x.v === v)!;
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [supplier, setSupplier] = useState("HPCL");
  const [mode, setMode] = useState("CASH");
  const [day, setDay] = useState(dates.yesterday ? "" : dates.today);
  return (
    <Panel title={<Bi en="Other entry: expenses, HPCL, lube" hi="अन्य खर्च / आमदनी" />}>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!day) return setState({ kind: "error", message: "Choose the day." });
          const r = await run(
            {
              kind: t.kind,
              businessDate: day,
              expenseCode: t.expense ?? null,
              party: t.supplier ? { name: supplier } : null,
              amount,
              mode: t.kind === "BANK_DEPOSIT" ? "CASH" : mode,
              description: desc || null,
            },
            `${t.label}: saved.`,
          );
          if (r) {
            setAmount("");
            setDesc("");
          }
        }}
      >
        <select className="inp w-52" value={v} onChange={(e) => setV(e.target.value)}>
          {types.map((x) => (
            <option key={x.v} value={x.v}>
              {x.label}
            </option>
          ))}
        </select>
        {t.supplier && <input className="inp w-28" placeholder="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />}
        <input className="inp num w-28" inputMode="decimal" placeholder="Amount ₹" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} />
        {t.kind !== "BANK_DEPOSIT" && (
          <select className="inp w-24" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="BANK_TRANSFER">Bank</option>
          </select>
        )}
        <input className="inp min-w-32 flex-1" placeholder="Details (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <DayChoice dates={dates} value={day} onChange={setDay} />
        <button className="btn" disabled={!amount || state.kind === "saving"}>
          {state.kind === "saving" ? "Saving…" : "Save"}
        </button>
      </form>
      <SaveStatus state={state} />
    </Panel>
  );
}
