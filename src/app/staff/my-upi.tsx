"use client";

import { useState } from "react";
import { SaveStatus } from "@/components/forms";
import { Bi, Panel } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { inr } from "@/lib/format";
import type { StaffPayMode, UpiPayment } from "@/server/money/service";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const LABEL: Record<StaffPayMode, string> = { UPI: "UPI", CARD: "Card" };

/** The employee enters each amount received on the QR (UPI) or the card machine; net totals go to the register. */
export function MyUpi({
  date,
  totals,
  payments,
  upiOn = true,
}: {
  date: string;
  totals: Record<StaffPayMode, string>;
  payments: UpiPayment[];
  upiOn?: boolean; // owner setting: workers type each UPI payment (else only card)
}) {
  const [amount, setAmount] = useState("");
  const modes: StaffPayMode[] = upiOn ? ["UPI", "CARD"] : ["CARD"];
  const [mode, setMode] = useState<StaffPayMode>(modes[0]);
  const add = useAction<{ amount: string; mode: StaffPayMode; totals: Record<StaffPayMode, string> }>("/api/my-upi");
  const cancel = useAction<{ cancelled: string; mode: StaffPayMode; totals: Record<StaffPayMode, string> }>("/api/my-upi");
  const live = (m: StaffPayMode) => payments.filter((p) => !p.cancelled && p.mode === m).length;
  return (
    <Panel
      title={upiOn ? <Bi en="UPI / Card received" hi="UPI / कार्ड मिला" /> : <Bi en="Card received" hi="कार्ड मिला" />}
      right={
        <span className="text-sm">
          {upiOn && (
            <>
              UPI <b className="num">{inr(totals.UPI)}</b> ·{" "}
            </>
          )}
          Card <b className="num">{inr(totals.CARD)}</b>
        </span>
      }
    >
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          cancel.setState({ kind: "idle" });
          if (!amount) return add.setState({ kind: "error", message: "Type the amount received." });
          add.run(
            { action: "add", mode, amount, businessDate: date },
            (d) => `${LABEL[d.mode]} ${inr(d.amount)} added. Your ${LABEL[d.mode]} total today: ${inr(d.totals[d.mode])}.`,
            () => setAmount(""),
          );
        }}
      >
        <div className="flex overflow-hidden rounded border border-line">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`h-[2.1rem] px-3 text-sm font-semibold ${mode === m ? "bg-brand text-white" : "bg-white"}`}
            >
              {LABEL[m]}
            </button>
          ))}
        </div>
        <input
          className="inp num min-w-0 flex-1"
          inputMode="decimal"
          placeholder={`Amount received by ${LABEL[mode]} ₹`}
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
        />
        <button className="btn" disabled={!amount || add.state.kind === "saving"}>
          {add.state.kind === "saving" ? "Saving…" : "Add"}
        </button>
      </form>
      <SaveStatus state={add.state} />
      <SaveStatus state={cancel.state} />

      {payments.length > 0 && (
        <table className="reg mt-2 text-sm">
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className={p.cancelled ? "text-muted line-through" : ""}>
                <td className="text-xs text-muted">{time(p.at)}</td>
                <td className="text-xs font-semibold">{LABEL[p.mode]}</td>
                <td className="num">{inr(p.amount)}</td>
                <td className="w-16 text-right">
                  {!p.cancelled && (
                    <button
                      type="button"
                      className="text-xs text-red-700 underline"
                      disabled={cancel.state.kind === "saving"}
                      onClick={() => {
                        add.setState({ kind: "idle" });
                        if (confirm(`Cancel ${LABEL[p.mode]} ${inr(p.amount)} entered at ${time(p.at)}? (typed by mistake)`))
                          cancel.run(
                            { action: "cancel", paymentId: p.id },
                            (d) => `Cancelled ${LABEL[d.mode]} ${inr(d.cancelled)}. Your ${LABEL[d.mode]} total today: ${inr(d.totals[d.mode])}.`,
                          );
                      }}
                    >
                      wrong
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {(["UPI", "CARD"] as const)
              .filter((m) => live(m) > 0)
              .map((m) => (
                <tr key={m} className="font-semibold">
                  <td colSpan={2}>
                    {LABEL[m]} total ({live(m)})
                  </td>
                  <td className="num">{inr(totals[m])}</td>
                  <td></td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
      <p className="mt-1.5 text-xs text-muted">
        {upiOn ? "Choose UPI or Card, then enter each payment as it comes." : "Enter each card payment as it comes. UPI is not typed: the owner reads your QR's total from Paytm."} {" "}
        Typed wrong? Press &quot;wrong&quot; and enter it again.
      </p>
    </Panel>
  );
}
