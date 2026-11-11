"use client";

import { useEffect, useRef, useState } from "react";
import { inr } from "@/lib/format";

export type Cust = { id: string; name: string; phone: string | null; balance: string; vehicles: string | null };

/** Drop-down of existing customers: type part of the name, phone or vehicle number. Arrow keys + Enter work. */
export function CustomerPicker({ customers, value, onChange }: { customers: Cust[]; value: Cust | null; onChange: (c: Cust | null) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const needle = q.trim().toLowerCase();
  const list = customers
    .filter((c) => !needle || c.name.toLowerCase().includes(needle) || (c.phone ?? "").includes(needle) || (c.vehicles ?? "").toLowerCase().includes(needle.replace(/\s/g, "")))
    .slice(0, 50);

  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (c: Cust) => {
    onChange(c);
    setQ("");
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      {value && !open ? (
        <button type="button" className="inp flex w-full items-center justify-between text-left" onClick={() => setOpen(true)}>
          <span className="truncate font-semibold">{value.name}</span>
          <span className="ml-2 text-xs text-muted">change ▾</span>
        </button>
      ) : (
        <input
          className="inp w-full"
          autoFocus={open}
          placeholder={`Select customer (${customers.length}) · ग्राहक चुनें`}
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setHi(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => Math.min(h + 1, list.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && open && list[hi]) {
              e.preventDefault();
              pick(list[hi]);
            } else if (e.key === "Escape") setOpen(false);
          }}
        />
      )}
      {open && (
        <ul className="absolute z-20 mt-0.5 max-h-72 w-full overflow-y-auto rounded border border-line bg-white shadow-lg">
          {list.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">No customer found: add them in “New udhari customer”.</li>}
          {list.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                className={`flex w-full items-baseline justify-between gap-2 px-2 py-1 text-left ${i === hi ? "bg-[#e8eef5]" : "hover:bg-soft"}`}
              >
                <span className="truncate">
                  {c.name}
                  <span className="ml-1 text-xs text-muted">{[c.phone, c.vehicles].filter(Boolean).join(" · ")}</span>
                </span>
                <span className={`num text-sm ${c.balance.startsWith("-") ? "text-green-700" : ""}`}>{inr(c.balance)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
