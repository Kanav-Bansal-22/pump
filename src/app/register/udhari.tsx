"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CustomerPicker, type Cust } from "@/components/customer-picker";
import { SaveStatus } from "@/components/forms";
import { useAction } from "@/components/use-action";
import { Bi, Panel } from "@/components/ui";
import { apiPost } from "@/lib/api-client";
import { inr, niceDate } from "@/lib/format";
import { DayChoice } from "./day-choice";

type Statement = {
  party: { id: string; name: string; phone: string | null };
  lines: Array<{ date: string; source_type: string; narration: string; debit: string; credit: string; vehicle_no: string | null; balance: string }>;
  balance: string;
  vehicles: string[];
};

const MODES = [
  ["CASH", "Cash"],
  ["UPI", "UPI"],
  ["BANK_TRANSFER", "Bank"],
] as const;

const DESC: Record<string, string> = {
  CREDIT_SALE: "Udhari given",
  CUSTOMER_REPAYMENT: "Received",
  OPENING_BALANCE: "Old balance",
  REVERSAL: "Cancelled",
};

/** Udhari given / received against an existing customer, with the customer's account shown below. */
export function Udhari({
  customers,
  dates,
  earliest,
}: {
  customers: Array<Cust & Record<string, unknown>>;
  dates: { today: string; yesterday: string | null };
  earliest?: string | null; // owner: udhari can also go to an earlier day from this date
}) {
  const [cust, setCust] = useState<Cust | null>(null);
  const [type, setType] = useState<"GIVEN" | "RECEIVED">("GIVEN");
  const [amount, setAmount] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [mode, setMode] = useState("CASH");
  const [day, setDay] = useState(dates.yesterday ? "" : dates.today);
  const { state, run, setState } = useAction<{ entryNo: string; amount: string }>("/api/entries");
  const [stmt, setStmt] = useState<Statement | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const load = async (id: string) => {
    const r = await apiPost<Statement>("/api/customers", { partyId: id });
    if (r.ok) setStmt(r.data);
  };
  const choose = (c: Cust | null) => {
    setCust(c);
    setStmt(null);
    if (c) {
      load(c.id);
      setTimeout(() => amountRef.current?.focus(), 0);
    }
  };

  const save = () => {
    if (!cust) return setState({ kind: "error", message: "Select the customer first." });
    if (!day) return setState({ kind: "error", message: "Choose the day." });
    const who = cust;
    run(
      {
        kind: type === "GIVEN" ? "CREDIT_SALE" : "CUSTOMER_REPAYMENT",
        businessDate: day,
        party: { id: who.id },
        amount,
        vehicleNo: type === "GIVEN" ? vehicle || null : null,
        mode: type === "RECEIVED" ? mode : null,
      },
      (d) => `#${d.entryNo}: ${type === "GIVEN" ? "udhari given to" : "received from"} ${who.name}, ${inr(d.amount)}${day !== dates.today ? ` (${niceDate(day)})` : ""}`,
      () => {
        setAmount("");
        setVehicle("");
        load(who.id);
      },
    );
  };

  return (
    <Panel title={<Bi en="Udhari" hi="उधारी" />} right={<Link href="/customers" className="underline">all customers</Link>}>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <CustomerPicker customers={customers} value={cust} onChange={choose} />
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex overflow-hidden rounded border border-line">
            {(["GIVEN", "RECEIVED"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`h-[2.1rem] px-3 text-sm font-semibold ${type === t ? (t === "GIVEN" ? "bg-red-700 text-white" : "bg-green-700 text-white") : "bg-white"}`}
              >
                {t === "GIVEN" ? "Given · दी" : "Received · मिली"}
              </button>
            ))}
          </div>
          <input ref={amountRef} className="inp num w-32" inputMode="decimal" placeholder="Amount ₹" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} />
          {type === "GIVEN" ? (
            <input className="inp w-36" placeholder="Car no. (optional)" value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} list="cust-vehicles" />
          ) : (
            <select className="inp w-28" value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          )}
          <datalist id="cust-vehicles">{stmt?.vehicles.map((v) => <option key={v} value={v} />)}</datalist>
          <DayChoice dates={dates} value={day} onChange={setDay} earliest={earliest} />
          <button className="btn" disabled={!cust || !amount || state.kind === "saving"}>
            {state.kind === "saving" ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
      <SaveStatus state={state} />

      {cust && stmt && (
        <div className="mt-3 rounded border border-line">
          <div className="flex flex-wrap items-baseline justify-between gap-2 bg-soft px-2 py-1.5">
            <span>
              <b>{stmt.party.name}</b> <span className="text-xs text-muted">{[stmt.party.phone, stmt.vehicles.join(", ")].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="text-sm">
              {stmt.balance.startsWith("-") ? "Advance" : "Outstanding"}{" "}
              <b className={`num text-base ${stmt.balance.startsWith("-") ? "text-green-700" : "text-red-700"}`}>{inr(stmt.balance.replace("-", ""))}</b>
            </span>
          </div>
          <div className="overflow-x-auto">
          <table className="reg text-sm">
            <thead>
              <tr>
                <th>Date</th>
                <th>Details</th>
                <th className="text-right">Given</th>
                <th className="text-right">Received</th>
                <th className="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {stmt.lines.slice(-8).map((l, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap">{niceDate(l.date)}</td>
                  <td>
                    {DESC[l.source_type] ?? l.source_type}
                    {l.vehicle_no && <span className="text-xs text-muted"> · {l.vehicle_no}</span>}
                  </td>
                  <td className="num">{l.debit !== "0.00" ? inr(l.debit) : ""}</td>
                  <td className="num">{l.credit !== "0.00" ? inr(l.credit) : ""}</td>
                  <td className="num">{inr(l.balance)}</td>
                </tr>
              ))}
              {stmt.lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-muted">
                    No entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
          <div className="border-t border-line px-2 py-1 text-right text-xs">
            {stmt.lines.length > 8 && <span className="mr-2 text-muted">showing last 8 of {stmt.lines.length}</span>}
            <Link href={`/customers/${stmt.party.id}`} className="text-accent underline">
              full account →
            </Link>
          </div>
        </div>
      )}
    </Panel>
  );
}
