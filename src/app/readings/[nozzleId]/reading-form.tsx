"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { SaveStatus, type SaveState } from "@/components/forms";
import { Card } from "@/components/ui";
import { apiPost, newEntryKey } from "@/lib/api-client";
import { inr, niceDate, niceTime, num } from "@/lib/format";
import type { Board, Evaluation } from "@/server/meters/service";

type Saved = Evaluation & { pointId: string; status: "ACCEPTED" | "REVIEW" };

export function ReadingForm({ nozzle }: { nozzle: Board[number] }) {
  const [value, setValue] = useState("");
  const [step, setStep] = useState<"type" | "confirm" | "done">("type");
  const [preview, setPreview] = useState<Evaluation | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  // One key per intended save. Kept across "Retry" so a dropped connection never saves twice.
  const entryKey = useRef(newEntryKey());

  if (!nozzle.last) return <Card>The owner must enter this nozzle&apos;s starting reading first.</Card>;

  const check = async () => {
    setState({ kind: "saving" });
    const r = await apiPost<Evaluation>("/api/readings/preview", { nozzleId: nozzle.nozzleId, reading: value });
    if (!r.ok) return setState({ kind: "error", message: r.error.message, messageHi: r.error.messageHi });
    setPreview(r.data);
    setState({ kind: "idle" });
    setStep("confirm");
  };

  const save = async () => {
    if (!preview) return;
    setState({ kind: "saving" });
    const r = await apiPost<Saved>("/api/readings", { nozzleId: nozzle.nozzleId, reading: value, prevPointId: preview.prevPointId }, entryKey.current);
    if (!r.ok) {
      // A refused reading (e.g. lower than yesterday) is not "used up": a corrected value gets a new key.
      if (r.error.code !== "NO_CONNECTION" && r.error.code !== "SERVER_ERROR") entryKey.current = newEntryKey();
      if (r.error.code === "H4_STALE") setTimeout(() => window.location.reload(), 2500);
      return setState({ kind: "error", message: r.error.message, messageHi: r.error.messageHi });
    }
    setSaved(r.data);
    setState({ kind: "saved", message: r.data.status === "ACCEPTED" ? "Saved. / सेव हो गया।" : "Saved, sent to owner for review. / सेव हुआ, मालिक जाँचेंगे।" });
    setStep("done");
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-sm text-muted">Opening (automatic) / ओपनिंग (अपने आप)</div>
        <div className="font-mono text-3xl text-muted">{num(nozzle.last.reading)}</div>
        <div className="text-sm text-muted">
          {niceTime(nozzle.last.at)} · {nozzle.last.byName}
        </div>
      </Card>

      {step === "type" && (
        <Card>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              check();
            }}
          >
            <label className="block">
              <span className="mb-2 block text-lg font-semibold">
                Closing reading on the meter now
                <br />
                <span className="text-base font-normal opacity-80">मीटर पर अभी की रीडिंग</span>
              </span>
              <input
                inputMode="decimal"
                autoComplete="off"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="e.g. 8496290.94"
                className="w-full rounded-xl border-2 border-line bg-white px-4 py-4 text-center font-mono text-3xl text-black outline-none focus:border-brand"
              />
            </label>
            <div className="mt-2 text-sm text-muted">Closing for {niceDate(nozzle.closingDate)}</div>
            <button
              type="submit"
              disabled={!value || state.kind === "saving"}
              className="mt-4 w-full rounded-2xl bg-brand px-4 py-4 text-xl font-bold text-white disabled:opacity-50"
            >
              {state.kind === "saving" ? "⏳ Checking… / जाँच रहे हैं…" : "Next → / आगे"}
            </button>
          </form>
          <SaveStatus state={state} />
        </Card>
      )}

      {step === "confirm" && preview && (
        <Card className="border-2 border-brand">
          <h2 className="mb-3 text-lg font-bold">Check and confirm / जाँचें और पक्का करें</h2>
          <table className="w-full text-lg">
            <tbody>
              <Row k="Closing / क्लोज़िंग" v={num(preview.closing)} strong />
              <Row k="Opening / ओपनिंग" v={num(preview.opening)} />
              <Row k="Litres / लीटर" v={num(preview.litres)} strong />
              {(preview.testsReturned !== "0.000" || preview.testsNotReturned !== "0.000") && (
                <Row k="Testing fuel / टेस्टिंग" v={`${num(preview.testsReturned)} + ${num(preview.testsNotReturned)}`} />
              )}
              <Row k="Rate / रेट" v={preview.rate ? inr(preview.rate) : "not set yet"} />
              <Row k="Sale value / बिक्री" v={preview.value ? inr(preview.value) : "—"} strong />
            </tbody>
          </table>
          {preview.flags.length > 0 && (
            <div className="mt-3 rounded-xl bg-orange-100 p-3 text-base text-orange-900">
              {preview.flags.map((f) => (
                <div key={f.code}>
                  🟡 {f.en}
                  <div className="text-sm">{f.hi}</div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setStep("type");
                setState({ kind: "idle" });
              }}
              className="rounded-2xl border-2 border-line px-4 py-4 text-lg"
            >
              ← Change / बदलें
            </button>
            <button
              type="button"
              onClick={save}
              disabled={state.kind === "saving"}
              className="rounded-2xl bg-green-700 px-4 py-4 text-lg font-bold text-white disabled:opacity-60"
            >
              {state.kind === "saving" ? "⏳ Saving…" : state.kind === "error" ? "Retry / फिर से" : "Save / सेव"}
            </button>
          </div>
          <SaveStatus state={state} />
        </Card>
      )}

      {step === "done" && saved && (
        <Card>
          <SaveStatus state={state} />
          <div className="mt-3 text-lg">
            {num(saved.litres)} L · {saved.value ? inr(saved.value) : "rate not set"}
          </div>
          <Link href="/readings" className="mt-4 block rounded-2xl bg-brand px-4 py-4 text-center text-xl font-bold text-white">
            Next nozzle → / अगला नोज़ल
          </Link>
        </Card>
      )}
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-2 pr-2 text-base">{k}</td>
      <td className={`py-2 text-right font-mono ${strong ? "text-xl font-bold" : ""}`}>{v}</td>
    </tr>
  );
}
