"use client";

import Link from "next/link";
import { useState } from "react";
import { SaveStatus } from "@/components/forms";
import { Bi, Panel } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { WhatsAppShare } from "@/components/whatsapp-share";
import { inr, niceDate, num } from "@/lib/format";
import type { DayBalance } from "@/server/money/service";

type Summary = Omit<DayBalance, "_site" | "_fuel">;

function Row({ label, v, sign, bold, tone }: { label: string; v: string | null; sign?: string; bold?: boolean; tone?: string }) {
  return (
    <tr className={bold ? "font-semibold" : ""}>
      <td className="w-5 text-muted">{sign}</td>
      <td>{label}</td>
      <td className={`num ${tone ?? ""}`}>{v == null ? "" : inr(v)}</td>
    </tr>
  );
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** Each worker's own Paytm QR: the QR total (from the Paytm Business app) against the payments they typed. */
function QrChecks({ s }: { s: Summary }) {
  const rows = s.qr.checks;
  const typing = s.qr.typeEach;
  const sum = (k: "typed" | "qr") => rows.reduce((a, r) => a + Math.round(Number(r[k] ?? 0) * 100), 0) / 100;
  return (
    <div className="mt-2 rounded border border-line">
      <div className="bg-soft px-2 py-1 text-xs font-semibold">UPI by each worker&apos;s QR · हर कर्मचारी का QR</div>
      <div className="overflow-x-auto">
        <table className="reg text-sm">
          <thead>
            <tr>
              <th>QR</th>
              {typing && <th className="text-right">Typed on phone</th>}
              <th className="text-right">Paytm total</th>
              <th>Check</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = r.difference;
              return (
                <tr key={r.userId ?? "SHOP"}>
                  <td>
                    {r.name}
                    {!r.ownQr && <span className="text-xs text-muted"> · no own QR</span>}
                  </td>
                  {typing && <td className="num">{r.typed == null ? "" : inr(r.typed)}</td>}
                  <td className="num">{r.qr == null ? <span className="text-xs text-muted">not typed</span> : inr(r.qr)}</td>
                  <td className={`text-xs ${d == null ? "text-muted" : d === "0.00" ? "text-green-700" : "font-semibold text-orange-800"}`}>
                    {d == null
                      ? r.ownQr && r.qr == null
                        ? "type the Paytm total below"
                        : ""
                      : d === "0.00"
                        ? "✓ matches"
                        : d.startsWith("-")
                          ? `typed ${inr(d.slice(1))} more than the QR got`
                          : `${inr(d)} on the QR not typed`}
                  </td>
                </tr>
              );
            })}
            <tr className="font-semibold">
              <td>Total</td>
              {typing && <td className="num">{inr(sum("typed").toFixed(2))}</td>}
              <td className="num">{inr(sum("qr").toFixed(2))}</td>
              <td className="text-xs font-normal text-muted">Paytm totals added = the day&apos;s UPI</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** UPI / card amounts entered on the employees' phones, checked against the QR app / card machine total typed at End day. */
function StaffCollections({ s }: { s: Summary }) {
  return (
    <div className="mt-2 space-y-2">
      {s.staffChecks.filter((chk) => !(chk.mode === "UPI" && s.qr.checks.length > 0)).map((chk) => {
        const d = chk.difference;
        const what = chk.mode === "UPI" ? "QR app" : "card machine";
        const What = what[0].toUpperCase() + what.slice(1);
        return (
          <div key={chk.mode} className="rounded border border-line">
            <div className="bg-soft px-2 py-1 text-xs font-semibold">
              {chk.label} received by employee (net) · कर्मचारी {chk.label === "UPI" ? "UPI" : "कार्ड"}
            </div>
            <table className="reg text-sm">
              <tbody>
                {s.staffUpi
                  .filter((u) => u.mode === chk.mode)
                  .map((u) => (
                    <tr key={u.userId}>
                      <td>{u.name}</td>
                      <td className="text-xs text-muted">
                        {u.payments} payment{u.payments === 1 ? "" : "s"} · last {hhmm(u.at)}
                      </td>
                      <td className="num">{inr(u.amount)}</td>
                    </tr>
                  ))}
                <tr className="font-semibold">
                  <td colSpan={2}>Net {chk.label} entered by staff</td>
                  <td className="num">{inr(chk.staff)}</td>
                </tr>
                {chk.machine != null && (
                  <tr className="font-semibold">
                    <td colSpan={2}>
                      {What} total (typed at End day)
                    </td>
                    <td className="num">{inr(chk.machine)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className={`px-2 py-1 text-sm font-medium ${d == null ? "text-muted" : d === "0.00" ? "text-green-700" : "bg-orange-50 text-orange-900"}`}>
              {d == null
                ? `Check: type the ${what}'s total for the day in the ${chk.label} box below.`
                : d === "0.00"
                  ? `✓ ${What} total matches what staff entered.`
                  : d.startsWith("-")
                    ? `⚠ Staff entered ${inr(d.slice(1))} MORE than the ${what} shows. Check each person's entries.`
                    : `⚠ ${What} shows ${inr(d)} more than staff entered (someone missed an entry). The ${what} total is what counts.`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The day's balance in the register's order, and the End day button. */
export function DaySummary({
  summary: s,
  isOwner,
  integrityCode,
  pump,
}: {
  summary: Summary;
  isOwner: boolean;
  integrityCode: string | null;
  pump?: string;
}) {
  const { state, run, setState } = useAction<{ difference: string | null; integrityCode: string }>("/api/day");
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [needReason, setNeedReason] = useState(false);
  const totals = useAction("/api/day");
  const [modes, setModes] = useState<Record<string, string>>({});
  const [qrBox, setQrBox] = useState<Record<string, string>>({});
  // only the boxes actually typed in are sent; empty boxes keep the saved total
  const typed = () => Object.fromEntries(Object.entries(modes).filter(([, v]) => v.trim() !== ""));
  const typedQr = () => Object.fromEntries(Object.entries(qrBox).filter(([, v]) => v.trim() !== ""));
  // workers' own QRs: one box per QR (and the shop's own QR); their sum is the day's UPI
  const byQr = s.qr.workers.length > 0 || s.qr.checks.some((r) => r.qr != null);
  const qrBoxes = [
    ...s.qr.checks.filter((r) => r.ownQr && r.userId != null).map((r) => ({ key: r.userId!, name: r.name, now: r.qr })),
    { key: "SHOP", name: "Shop QR", now: s.qr.checks.find((r) => r.userId == null)?.qr ?? null },
  ];
  const ended = s.status === "LOCKED";
  const showCash = isOwner || ended; // blind count: staff see the expected cash only after the day is ended
  const diff = s.difference;
  const done = s.sales.complete; // all nozzle closings + rates in: sales (and so cash) are known

  return (
    <Panel
      title={<Bi en={`Day summary ${niceDate(s.date)}`} hi="दिन का हिसाब" />}
      right={ended ? <span className="font-semibold text-green-700">✓ ended {integrityCode && `· ${integrityCode}`}</span> : s.status === "SUBMITTED" ? "cash counted" : "open"}
    >
      <table className="reg">
        <tbody>
          {done ? (
            Object.entries(s.sales.byFuel).map(([f, x]) => (
              <Row key={f} label={`${f === "PETROL" ? "Petrol (MS)" : "Diesel (HSD)"}: ${num(x.litres)} L`} v={x.value} />
            ))
          ) : (
            <tr>
              <td></td>
              <td colSpan={2} className="text-sm text-orange-800">
                Fuel sales: known after the nozzle closing (next morning 8 AM)
                {s.sales.missingReadings.length > 0 && s.sales.missingReadings.length < 6 && (
                  <span className="text-xs text-muted"> · still missing: {s.sales.missingReadings.join(", ")}</span>
                )}
              </td>
            </tr>
          )}
          <Row label="Total fuel sales" v={done ? s.sales.total : null} bold />
          {s.collections
            .filter((x) => x.total != null)
            .map((x) => (
              <tr key={x.mode}>
                <td className="w-5 text-muted">−</td>
                <td>
                  Received by {x.label}
                  <div className="text-xs text-muted">
                    {x.label} total {inr(x.total)}
                    {x.source === "staff" && " (entered by staff)"}
                    {x.alreadyEntered !== "0.00" && <> − udhari / lube already entered by {x.label} {inr(x.alreadyEntered)}</>}
                  </div>
                </td>
                <td className={`num ${x.sales.startsWith("-") ? "text-red-700" : ""}`}>{inr(x.sales)}</td>
              </tr>
            ))}
          <Row sign="−" label="Udhari given (fuel on credit)" v={s.udhariGiven} />
          <Row label="Fuel sales received in cash" v={done ? s.cashSales : null} bold />
          <Row sign="+" label="Udhari received (cash)" v={s.udhariReceivedCash} />
          <Row sign="+" label="Lube / other received (cash)" v={s.otherInCash} />
          <Row sign="−" label="Expenses paid in cash" v={s.paymentsCash} />
          {!done ? (
            <tr>
              <td></td>
              <td colSpan={2} className="text-xs text-muted">
                Cash that should be in hand: worked out once the nozzle closing is entered
              </td>
            </tr>
          ) : showCash ? (
            <Row label="Cash that should be in hand" v={s.expectedCash} bold />
          ) : (
            <tr>
              <td></td>
              <td colSpan={2} className="text-xs text-muted">
                Cash that should be in hand: shown after End day (count first)
              </td>
            </tr>
          )}
          {s.counted != null && showCash && <Row label={`Cash counted (${s.countedBy})`} v={s.counted} bold />}
          {diff != null && showCash && (
            <Row
              label={diff === "0.00" ? "Matches ✓" : diff.startsWith("-") ? "Short" : "Excess"}
              v={diff.replace("-", "")}
              bold
              tone={diff === "0.00" ? "text-green-700" : diff.startsWith("-") ? "text-red-700" : "text-orange-700"}
            />
          )}
        </tbody>
      </table>
      {(s.nonCashIn !== "0.00" || s.paymentsNonCash !== "0.00") && (
        <div className="mt-1 text-xs text-muted">
          Not in the cash drawer: received by UPI / card / bank {inr(s.nonCashIn)}, expenses paid by UPI / bank {inr(s.paymentsNonCash)}.
        </div>
      )}

      {s.qr.checks.length > 0 && <QrChecks s={s} />}
      {s.staffChecks.length > 0 && <StaffCollections s={s} />}

      {!ended && s.problems.filter((p) => !p.startsWith("Cash not counted")).length > 0 && (
        <ul className="mt-2 list-disc rounded border border-orange-300 bg-orange-50 py-1 pl-6 pr-2 text-sm text-orange-900">
          {s.problems
            .filter((p) => !p.startsWith("Cash not counted"))
            .map((p) => (
              <li key={p}>{p}</li>
            ))}
        </ul>
      )}

      {!ended ? (
        <form
          className="mt-3 border-t border-line pt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(
              { action: "endDay", date: s.date, counted, overrideReason: needReason ? reason : null, collections: typed(), qr: byQr ? typedQr() : null },
              "Day ended and saved in Daily records.",
            );
            if (!r) setNeedReason(isOwner);
          }}
        >
          <div className="mb-1 text-xs font-semibold text-muted">
            Money received by other modes today (total shown on each machine / app) · UPI / कार्ड / बैंक
          </div>
          {byQr && (
            <div className="mb-2">
              <div className="mb-1 text-xs text-muted">UPI: each QR&apos;s total from the Paytm Business app (8 AM to 8 AM)</div>
              <div className="flex flex-wrap items-end gap-2">
                {qrBoxes.map((b) => (
                  <label key={b.key} className="w-28">
                    <span className="block truncate text-xs text-muted">{b.name} ₹</span>
                    <input
                      className="inp num w-full"
                      inputMode="decimal"
                      placeholder={b.now ?? "0"}
                      value={qrBox[b.key] ?? ""}
                      onChange={(e) => setQrBox({ ...qrBox, [b.key]: e.target.value.replace(/[^\d.,]/g, "") })}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="mb-2 flex flex-wrap items-end gap-2">
            {s.collections.filter((x) => !(byQr && x.mode === "UPI")).map((x) => (
              <label key={x.mode} className="w-28">
                <span className="block text-xs text-muted">{x.label} ₹</span>
                <input
                  className="inp num w-full"
                  inputMode="decimal"
                  placeholder={x.total ?? "0"}
                  value={modes[x.mode] ?? ""}
                  onChange={(e) => setModes({ ...modes, [x.mode]: e.target.value.replace(/[^\d.,]/g, "") })}
                />
              </label>
            ))}
            <button
              type="button"
              className="btn-light"
              disabled={(!Object.values(modes).some((v) => v) && !Object.values(qrBox).some((v) => v)) || totals.state.kind === "saving"}
              onClick={async () => {
                if (await totals.run({ action: "collections", date: s.date, amounts: typed(), qr: byQr ? typedQr() : null }, "Totals saved.")) {
                  setModes({});
                  setQrBox({});
                }
              }}
            >
              Save totals
            </button>
          </div>
          <SaveStatus state={totals.state} />
          <div className="flex flex-wrap items-end gap-2">
          <label className="w-40">
            <span className="block text-xs text-muted">Cash counted ₹ · गिनी नकदी</span>
            <input className="inp num w-full" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0" />
          </label>
          {needReason && (
            <input className="inp min-w-48 flex-1" placeholder="Owner: reason to end anyway" value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
          <button
            className="btn btn-ok"
            disabled={!counted || state.kind === "saving"}
            onClick={() => state.kind === "error" && setState({ kind: "idle" })}
          >
            {state.kind === "saving" ? "Ending…" : `End day ${niceDate(s.date)}`}
          </button>
          </div>
        </form>
      ) : (
        <div className="mt-2 text-sm">
          Saved in{" "}
          <Link href={`/days/${s.date}`} className="text-accent underline">
            Daily records →
          </Link>
          {pump && (
            <div className="mt-2">
              <WhatsAppShare pump={pump} figures={s} />
            </div>
          )}
        </div>
      )}
      <SaveStatus state={state} />
    </Panel>
  );
}
