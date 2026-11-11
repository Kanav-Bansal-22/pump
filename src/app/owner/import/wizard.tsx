"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { SaveStatus, type SaveState } from "@/components/forms";
import { Card } from "@/components/ui";
import { apiPost, newEntryKey } from "@/lib/api-client";
import { inr } from "@/lib/format";
import type { Preview } from "@/server/money/opening";

function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

export function ImportWizard({ today }: { today: string }) {
  const [date, setDate] = useState(today);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [registerTotal, setRegisterTotal] = useState("");
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const [done, setDone] = useState<{ created: number; matched: number; total: string } | null>(null);
  const key = useRef(newEntryKey());
  const fresh = () => (key.current = newEntryKey());

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setDone(null);
    setRegisterTotal("");
    setPreview(null);
    setState({ kind: "saving" });
    const r = await apiPost<Preview>("/api/owner/import", { action: "preview", fileName: file.name, fileBase64: await toBase64(file), openingDate: date }, fresh());
    if (!r.ok) return setState({ kind: "error", message: r.error.message, messageHi: r.error.messageHi });
    // The preview used this key; the confirmation is a different request and needs its own key.
    fresh();
    setPreview(r.data);
    setState({ kind: "idle" });
  };

  const confirm = async () => {
    if (!preview) return;
    setState({ kind: "saving" });
    const r = await apiPost<{ created: number; matched: number; total: string }>(
      "/api/owner/import",
      { action: "confirm", batchId: preview.batchId, registerTotal },
      key.current,
    );
    if (!r.ok) {
      if (r.error.code !== "NO_CONNECTION") fresh();
      return setState({ kind: "error", message: r.error.message, messageHi: r.error.messageHi });
    }
    setDone(r.data);
    setPreview(null);
    setState({ kind: "saved", message: "Old balances imported. / पुराना बकाया डल गया।" });
  };

  return (
    <div className="space-y-4">
      {!preview && (
        <Card>
          <label className="mb-3 block text-base">
            Balances as on (date) / किस तारीख का बकाया
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="ml-2 rounded-lg border-2 border-line bg-white px-2 py-1 text-black" />
          </label>
          <label className="block rounded-2xl border-2 border-dashed border-brand p-6 text-center text-lg">
            📄 Choose the Excel / CSV file / फ़ाइल चुनें
            <input type="file" accept=".xlsx,.csv" className="mt-3 block w-full text-base" onChange={(e) => upload(e.target.files?.[0])} />
          </label>
          {state.kind === "saving" && <div className="mt-3 text-lg">⏳ Reading the file…</div>}
          {!done && <SaveStatus state={state} />}
        </Card>
      )}

      {preview && (
        <>
          <Card>
            <h2 className="text-lg font-bold">{preview.fileName}</h2>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-green-100 p-2 text-green-900">
                <div className="text-2xl font-bold">{preview.counts.NEW}</div>new customers
              </div>
              <div className="rounded-xl bg-blue-100 p-2 text-blue-900">
                <div className="text-2xl font-bold">{preview.counts.MATCH_EXISTING}</div>already in app
              </div>
              <div className={`rounded-xl p-2 ${preview.counts.ERROR ? "bg-red-100 text-red-900" : "bg-gray-100 text-gray-700"}`}>
                <div className="text-2xl font-bold">{preview.counts.ERROR}</div>problems
              </div>
            </div>
            <div className="mt-3 text-base">
              They owe <b>{inr(preview.owing)}</b> · advances <b>{inr(preview.advance.replace("-", ""))}</b> · net total <b>{inr(preview.total)}</b>
            </div>
          </Card>

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-base">
              <thead>
                <tr className="border-b border-line text-left text-sm text-muted">
                  <th className="py-1">Row</th>
                  <th className="py-1">Name</th>
                  <th className="py-1 text-right">Amount</th>
                  <th className="py-1">Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.rowNo} className={`border-b border-line ${r.status === "ERROR" ? "bg-red-50 text-red-900" : ""}`}>
                    <td className="py-1">{r.rowNo}</td>
                    <td className="py-1">
                      {r.name || "—"} <span className="text-sm text-muted">{r.phone}</span>
                    </td>
                    <td className="py-1 text-right font-mono">{r.amount != null ? inr(r.amount) : "—"}</td>
                    <td className="py-1 text-sm">
                      {r.status === "NEW" ? "New customer" : r.status === "MATCH_EXISTING" ? `Add to existing: ${r.matchName}` : `❌ ${r.error}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {preview.counts.ERROR > 0 ? (
            <Card className="border-2 border-red-400">
              <div className="text-base">
                Fix the {preview.counts.ERROR} red row(s) in the Excel file, then upload it again. Nothing has been saved.
              </div>
              <button type="button" className="mt-3 rounded-xl border-2 border-line px-4 py-3" onClick={() => setPreview(null)}>
                ← Upload a corrected file
              </button>
            </Card>
          ) : (
            <Card className="border-2 border-green-700">
              <label className="block">
                <span className="mb-1 block text-lg font-semibold">
                  Total udhari written in the old register
                  <br />
                  <span className="text-base font-normal opacity-80">पुराने रजिस्टर में कुल उधारी</span>
                </span>
                <input
                  inputMode="decimal"
                  value={registerTotal}
                  onChange={(e) => setRegisterTotal(e.target.value)}
                  className="w-full rounded-xl border-2 border-line bg-white px-4 py-3 text-center font-mono text-2xl text-black"
                  placeholder="e.g. 4,74,902"
                />
              </label>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button type="button" className="rounded-2xl border-2 border-line px-3 py-4 text-lg" onClick={() => setPreview(null)}>
                  ← Cancel
                </button>
                <button
                  type="button"
                  disabled={!registerTotal || state.kind === "saving"}
                  onClick={confirm}
                  className="rounded-2xl bg-green-700 px-3 py-4 text-lg font-bold text-white disabled:opacity-50"
                >
                  {state.kind === "saving" ? "⏳ Importing…" : "Confirm import"}
                </button>
              </div>
              <SaveStatus state={state} />
            </Card>
          )}
        </>
      )}

      {done && (
        <Card>
          <SaveStatus state={state} />
          <div className="mt-2 text-lg">
            {done.created} new customers, {done.matched} added to existing customers · total {inr(done.total)}
          </div>
          <Link href="/udhari" className="mt-3 block text-center text-lg text-brand underline">
            Open the Udhari list →
          </Link>
        </Card>
      )}
    </div>
  );
}
