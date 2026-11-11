"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SaveStatus, type SaveState } from "./forms";
import { Card } from "./ui";
import { apiPost, newEntryKey } from "@/lib/api-client";
import { inr, niceDate } from "@/lib/format";

export type KindOption = {
  kind: string;
  en: string;
  hi: string;
  party: string | null;
  dir: "IN" | "OUT" | "CREDIT";
  modes: Array<{ code: string; en: string; hi: string }>;
};
type Party = { id: string; name: string; phone: string | null; balance: string | null };

const input = "w-full rounded-xl border-2 border-line bg-white px-4 py-3 text-lg text-black outline-none focus:border-brand";

export function EntryForm({
  options,
  dates,
  expenses,
  canSeeBalance,
}: {
  options: KindOption[];
  dates: { today: string; yesterday: string | null };
  expenses: Array<{ code: string; name_en: string; name_hi: string }>;
  canSeeBalance: boolean;
}) {
  const [kind, setKind] = useState(options[0].kind);
  const opt = options.find((o) => o.kind === kind)!;
  const [day, setDay] = useState<string | null>(dates.yesterday ? null : dates.today);
  const [party, setParty] = useState<Party | null>(null);
  const [newParty, setNewParty] = useState<{ name: string; phone: string } | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Party[]>([]);
  const [mode, setMode] = useState(opt.modes[0]?.code ?? "CASH");
  const [amount, setAmount] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [slip, setSlip] = useState("");
  const [fuel, setFuel] = useState<"" | "DIESEL" | "PETROL">("");
  const [litres, setLitres] = useState("");
  const [expense, setExpense] = useState("");
  const [desc, setDesc] = useState("");
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const [last, setLast] = useState<{ no: string; amount: string; text: string } | null>(null);
  const key = useRef(newEntryKey());

  const chooseKind = (k: string) => {
    const o = options.find((x) => x.kind === k)!;
    setKind(k);
    setMode(o.modes[0]?.code ?? "CASH");
    setParty(null);
    setNewParty(null);
    setResults([]);
  };

  useEffect(() => {
    if (!opt.party || party || newParty) return;
    const t = setTimeout(async () => {
      const r = await apiPost<Party[]>("/api/parties", { kind: opt.party, q });
      if (r.ok) setResults(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [q, opt.party, party, newParty]);

  const reset = () => {
    setParty(null);
    setNewParty(null);
    setQ("");
    setAmount("");
    setVehicle("");
    setSlip("");
    setLitres("");
    setDesc("");
    key.current = newEntryKey();
  };

  const save = async () => {
    if (!day) return setState({ kind: "error", message: "Choose which day this entry is for.", messageHi: "दिन चुनें।" });
    if (opt.party && !party && !newParty) return setState({ kind: "error", message: "Choose the name from the list, or add a new one.", messageHi: "नाम चुनें।" });
    if (kind === "EXPENSE" && !expense) return setState({ kind: "error", message: "Choose the expense type.", messageHi: "खर्च का प्रकार चुनें।" });
    setState({ kind: "saving" });
    const r = await apiPost<{ entryNo: string; amount: string }>(
      "/api/entries",
      {
        kind,
        businessDate: day,
        party: opt.party ? (party ? { id: party.id } : { name: newParty!.name, phone: newParty!.phone || null }) : null,
        expenseCode: kind === "EXPENSE" ? expense : null,
        mode: opt.dir === "CREDIT" ? null : mode,
        amount,
        vehicleNo: vehicle || null,
        slipNo: slip || null,
        fuelCode: fuel || null,
        litres: litres || null,
        description: desc || null,
      },
      key.current,
    );
    if (!r.ok) {
      if (r.error.code !== "NO_CONNECTION" && r.error.code !== "SERVER_ERROR") key.current = newEntryKey();
      return setState({ kind: "error", message: r.error.message, messageHi: r.error.messageHi });
    }
    const who = party?.name ?? newParty?.name ?? "";
    setLast({ no: r.data.entryNo, amount: r.data.amount, text: [opt.en, who, vehicle].filter(Boolean).join(" · ") });
    setState({ kind: "saved", message: `Saved as entry #${r.data.entryNo}. / सेव हो गया।` });
    reset();
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {options.length > 1 && (
        <Card>
          <div className="mb-2 text-base font-semibold">What is it? / क्या है?</div>
          <div className="grid grid-cols-2 gap-2">
            {options.map((o) => (
              <button
                key={o.kind}
                type="button"
                onClick={() => chooseKind(o.kind)}
                className={`rounded-xl border-2 px-3 py-3 text-left text-base ${o.kind === kind ? "border-brand bg-brand text-white" : "border-line"}`}
              >
                {o.en}
                <div className="text-sm opacity-80">{o.hi}</div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {dates.yesterday && (
        <Card>
          <div className="mb-2 text-base font-semibold">Which day? / कौन सा दिन?</div>
          <div className="grid grid-cols-2 gap-2">
            {[dates.yesterday, dates.today].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDay(d)}
                className={`rounded-xl border-2 px-3 py-3 text-base ${day === d ? "border-brand bg-brand text-white" : "border-line"}`}
              >
                {d === dates.yesterday ? "Yesterday (closing)" : "Today"}
                <div className="text-sm opacity-80">{niceDate(d)}</div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {opt.party && (
        <Card>
          <div className="mb-2 text-base font-semibold">{opt.party === "SUPPLIER" ? "Supplier / सप्लायर" : opt.party === "CUSTOMER" ? "Customer / ग्राहक" : "Name / नाम"}</div>
          {party ? (
            <div className="flex items-center justify-between rounded-xl bg-brand/10 p-3">
              <div>
                <div className="text-lg font-bold">{party.name}</div>
                <div className="text-sm text-muted">
                  {party.phone ?? ""} {canSeeBalance && party.balance != null && <>· Outstanding {inr(party.balance)}</>}
                </div>
              </div>
              <button type="button" className="rounded-lg border-2 border-line px-3 py-2" onClick={() => setParty(null)}>
                Change
              </button>
            </div>
          ) : newParty ? (
            <div className="space-y-2">
              <input className={input} placeholder="Full name / पूरा नाम" value={newParty.name} onChange={(e) => setNewParty({ ...newParty, name: e.target.value })} />
              <input className={input} placeholder="Phone (10 digits, optional)" inputMode="tel" value={newParty.phone} onChange={(e) => setNewParty({ ...newParty, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} />
              <button type="button" className="text-base text-brand underline" onClick={() => setNewParty(null)}>
                ← Search the list instead
              </button>
            </div>
          ) : (
            <div>
              <input className={input} placeholder="Type name or phone / नाम लिखें" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                {results.map((r) => (
                  <button key={r.id} type="button" onClick={() => setParty(r)} className="block w-full rounded-lg border border-line px-3 py-2 text-left">
                    <span className="text-lg">{r.name}</span> <span className="text-sm text-muted">{r.phone ?? ""}</span>
                    {canSeeBalance && r.balance != null && r.balance !== "0.00" && <span className="float-right text-sm">{inr(r.balance)}</span>}
                  </button>
                ))}
              </div>
              <button type="button" className="mt-2 w-full rounded-xl border-2 border-dashed border-line px-3 py-3 text-base" onClick={() => setNewParty({ name: q, phone: "" })}>
                + New {opt.party === "CUSTOMER" ? "customer" : "name"} / नया नाम
              </button>
            </div>
          )}
        </Card>
      )}

      {kind === "EXPENSE" && (
        <Card>
          <div className="mb-2 text-base font-semibold">Expense type / खर्च का प्रकार</div>
          <div className="grid grid-cols-2 gap-2">
            {expenses.map((e) => (
              <button
                key={e.code}
                type="button"
                onClick={() => setExpense(e.code)}
                className={`rounded-xl border-2 px-3 py-3 text-left text-base ${expense === e.code ? "border-brand bg-brand text-white" : "border-line"}`}
              >
                {e.name_en}
                <div className="text-sm opacity-80">{e.name_hi}</div>
              </button>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <label className="block">
          <span className="mb-1 block text-lg font-semibold">Amount ₹ / रकम</span>
          <input className={`${input} text-center font-mono text-3xl`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0" />
        </label>
        {opt.modes.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {opt.modes.map((m) => (
              <button key={m.code} type="button" onClick={() => setMode(m.code)} className={`rounded-xl border-2 px-2 py-3 text-base ${mode === m.code ? "border-brand bg-brand text-white" : "border-line"}`}>
                {m.en}
              </button>
            ))}
          </div>
        )}
      </Card>

      {kind === "CREDIT_SALE" && (
        <Card className="space-y-3">
          <input className={input} placeholder="Vehicle no. / गाड़ी नंबर" value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} />
          <input className={input} placeholder="Slip / bill no. / पर्ची नंबर" value={slip} onChange={(e) => setSlip(e.target.value)} />
          <div className="grid grid-cols-3 gap-2">
            {(["", "DIESEL", "PETROL"] as const).map((f) => (
              <button key={f || "none"} type="button" onClick={() => setFuel(f)} className={`rounded-xl border-2 px-2 py-3 text-base ${fuel === f ? "border-brand bg-brand text-white" : "border-line"}`}>
                {f === "" ? "Fuel: -" : f === "DIESEL" ? "Diesel" : "Petrol"}
              </button>
            ))}
          </div>
          <input className={input} inputMode="decimal" placeholder="Litres (optional) / लीटर" value={litres} onChange={(e) => setLitres(e.target.value.replace(/[^\d.]/g, ""))} />
        </Card>
      )}

      {(kind === "EXPENSE" || kind === "OTHER_INCOME" || kind === "LUBE_SALE" || kind === "SUPPLIER_PAYMENT" || opt.dir === "OUT") && (
        <Card>
          <input className={input} placeholder="Details (optional) / विवरण" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Card>
      )}

      <button type="submit" disabled={state.kind === "saving" || !amount} className="w-full rounded-2xl bg-green-700 px-4 py-4 text-xl font-bold text-white disabled:opacity-50">
        {state.kind === "saving" ? "⏳ Saving… / सेव हो रहा है…" : state.kind === "error" ? "Retry / फिर से" : "Save / सेव करें"}
      </button>
      <SaveStatus state={state} />
      {last && state.kind === "saved" && (
        <Card>
          <div className="text-base">
            #{last.no} · {last.text} · <b>{inr(last.amount)}</b>
          </div>
          <Link href="/" className="mt-3 block text-center text-base text-brand underline">
            Done → home
          </Link>
        </Card>
      )}
    </form>
  );
}
