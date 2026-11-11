"use client";

import Decimal from "decimal.js";
import Link from "next/link";
import { useState } from "react";
import { Panel } from "@/components/ui";
import { inr, niceDate } from "@/lib/format";

type Row = { id: string; name: string; phone: string | null; opening: string; given: string; received: string; balance: string; last_date: string | null; vehicles: string | null };

export function CustomerTable({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "balance" | "last">("balance");
  const needle = q.trim().toLowerCase();
  const list = rows
    .filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.phone ?? "").includes(needle) || (r.vehicles ?? "").toLowerCase().includes(needle))
    .sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : sort === "last" ? (b.last_date ?? "").localeCompare(a.last_date ?? "") : new Decimal(b.balance).cmp(a.balance),
    );
  const sum = (k: "opening" | "given" | "received" | "balance") => list.reduce((a, r) => a.plus(r[k]), new Decimal(0)).toFixed(2);
  const owing = list.filter((r) => !r.balance.startsWith("-") && r.balance !== "0.00").length;
  return (
    <Panel
      title={`${list.length} customers · ${owing} owe money`}
      right={
        <span className="flex items-center gap-2">
          <Link href="/customers/print" className="underline">
            print all ledgers
          </Link>
          · sort
          <select className="inp h-7 w-28 text-sm" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="balance">by balance</option>
            <option value="name">by name</option>
            <option value="last">by last entry</option>
          </select>
        </span>
      }
    >
      <input className="inp mb-2 max-w-sm" placeholder="Search name / phone / car no." value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="overflow-x-auto">
        <table className="reg min-w-[48rem]">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Phone</th>
              <th>Car no.</th>
              <th className="text-right">Old balance</th>
              <th className="text-right">Given</th>
              <th className="text-right">Received</th>
              <th className="text-right">Outstanding</th>
              <th>Last entry</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="hover:bg-soft">
                <td>
                  <Link href={`/customers/${r.id}`} className="font-semibold text-accent hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="text-muted">{r.phone ?? ""}</td>
                <td className="text-xs text-muted">{r.vehicles ?? ""}</td>
                <td className="num">{r.opening !== "0.00" ? inr(r.opening) : ""}</td>
                <td className="num">{r.given !== "0.00" ? inr(r.given) : ""}</td>
                <td className="num">{r.received !== "0.00" ? inr(r.received) : ""}</td>
                <td className={`num font-semibold ${r.balance.startsWith("-") ? "text-green-700" : r.balance === "0.00" ? "text-muted" : "text-red-700"}`}>
                  {r.balance.startsWith("-") ? `adv ${inr(r.balance.slice(1))}` : inr(r.balance)}
                </td>
                <td className="whitespace-nowrap text-sm text-muted">{r.last_date ? niceDate(r.last_date) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-soft font-semibold">
              <td colSpan={3}>Total</td>
              <td className="num">{inr(sum("opening"))}</td>
              <td className="num">{inr(sum("given"))}</td>
              <td className="num">{inr(sum("received"))}</td>
              <td className="num">{inr(sum("balance"))}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}
