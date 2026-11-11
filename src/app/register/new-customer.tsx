"use client";

import { useState } from "react";
import { SaveStatus } from "@/components/forms";
import { Bi, Panel } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { inr } from "@/lib/format";
import { DayChoice } from "./day-choice";

/** New udhari customer: name, amount, optional mobile and car number. Records the udhari given now. */
export function NewCustomer({ dates }: { dates: { today: string; yesterday: string | null } }) {
  const { state, run, setState } = useAction<{ entryNo: string; amount: string }>("/api/entries");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [phone, setPhone] = useState("");
  const [day, setDay] = useState(dates.yesterday ? "" : dates.today);
  return (
    <Panel title={<Bi en="New udhari customer" hi="नया उधारी ग्राहक" />}>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!day) return setState({ kind: "error", message: "Choose the day." });
          if (phone && phone.length !== 10) return setState({ kind: "error", message: "Mobile number must have 10 digits (or leave it empty)." });
          const r = await run(
            { kind: "CREDIT_SALE", businessDate: day, party: { name, phone: phone || null }, amount, vehicleNo: vehicle || null },
            `${name.trim()} added with udhari ${inr(amount.replace(/,/g, ""))}.`,
          );
          if (r) {
            setName("");
            setAmount("");
            setVehicle("");
            setPhone("");
          }
        }}
      >
        <input className="inp min-w-40 flex-[2]" placeholder="Customer name · नाम" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="inp num w-28" inputMode="decimal" placeholder="Amount ₹" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} />
        <input
          className="inp w-32"
          inputMode="tel"
          placeholder="Mobile (optional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(-10))}
        />
        <input className="inp w-32" placeholder="Car no. (optional)" value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} />
        <DayChoice dates={dates} value={day} onChange={setDay} />
        <button className="btn" disabled={name.trim().length < 2 || !amount || state.kind === "saving"}>
          {state.kind === "saving" ? "Saving…" : "Add"}
        </button>
      </form>
      <SaveStatus state={state} />
    </Panel>
  );
}
