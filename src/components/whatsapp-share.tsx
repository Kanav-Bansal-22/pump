"use client";

import { useState } from "react";
import { inr, niceDate, num } from "@/lib/format";

/** The figures the day message needs (a subset of the day balance). */
export type DayFigures = {
  date: string;
  sales: { byFuel: Record<string, { litres: string; value: string }>; total: string; complete: boolean };
  udhariGiven: string;
  udhariReceived: string;
  otherIn: string;
  paymentsAll: string;
  collections: Array<{ label: string; total: string | null }>;
  expectedCash: string;
  counted: string | null;
  difference: string | null;
  staffChecks: Array<{ mode?: string; label: string; staff: string; machine: string | null; difference: string | null }>;
  qr?: { checks: Array<{ name: string; typed: string | null; qr: string | null; difference: string | null }> };
};

/** Plain-text day summary, laid out for a WhatsApp message (bold with *…*). */
export function dayMessage(pump: string, d: DayFigures): string {
  const L: string[] = [`*${pump}*`, `*Day summary ${niceDate(d.date)}*`, ""];
  if (d.sales.complete) {
    for (const [f, x] of Object.entries(d.sales.byFuel)) L.push(`${f === "PETROL" ? "Petrol" : "Diesel"}: ${num(x.litres)} L = ${inr(x.value)}`);
    L.push(`*Fuel sales: ${inr(d.sales.total)}*`, "");
  } else L.push("Fuel sales: nozzle closing not entered", "");
  for (const x of d.collections.filter((c) => c.total != null)) L.push(`${x.label}: ${inr(x.total)}`);
  L.push(`Udhari given: ${inr(d.udhariGiven)}`, `Udhari received: ${inr(d.udhariReceived)}`);
  if (d.otherIn !== "0.00") L.push(`Lube / other income: ${inr(d.otherIn)}`);
  if (d.paymentsAll !== "0.00") L.push(`Expenses / payments: ${inr(d.paymentsAll)}`);
  if (d.sales.complete) L.push("", `Cash that should be in hand: ${inr(d.expectedCash)}`);
  if (d.counted != null) {
    L.push(`Cash counted: ${inr(d.counted)}`);
    if (d.difference != null)
      L.push(d.difference === "0.00" ? "✅ Cash matches" : d.difference.startsWith("-") ? `⚠️ Cash SHORT ${inr(d.difference.slice(1))}` : `⚠️ Cash excess ${inr(d.difference)}`);
  }
  const perQr = (d.qr?.checks.length ?? 0) > 0;
  // with workers' own QRs the per-person lines say whose QR is off; the UPI total check would only repeat it
  for (const k of d.staffChecks.filter((x) => x.difference != null && x.difference !== "0.00" && !(perQr && x.mode === "UPI")))
    L.push(`⚠️ ${k.label}: machine ${inr(k.machine)}, staff entered ${inr(k.staff)}`);
  for (const q of d.qr?.checks.filter((x) => x.difference != null && x.difference !== "0.00") ?? [])
    L.push(`⚠️ ${q.name} QR: Paytm ${inr(q.qr)}, typed ${inr(q.typed)}`);
  return L.join("\n");
}

/** Opens WhatsApp with the day's summary ready; the owner picks the person and presses send. Also copies. */
export function WhatsAppShare({ pump, figures }: { pump: string; figures: DayFigures }) {
  const [copied, setCopied] = useState(false);
  const text = dayMessage(pump, figures);
  return (
    <span className="no-print inline-flex flex-wrap items-center gap-2">
      <a
        href={`https://wa.me/?text=${encodeURIComponent(text)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center rounded border border-green-700 bg-green-700 px-3 py-1 text-sm font-semibold text-white hover:bg-green-800"
      >
        Send on WhatsApp
      </a>
      <button
        type="button"
        className="rounded border border-line bg-white px-3 py-1 text-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          } catch {
            prompt("Copy this message:", text);
          }
        }}
      >
        {copied ? "✓ Copied" : "Copy text"}
      </button>
    </span>
  );
}
