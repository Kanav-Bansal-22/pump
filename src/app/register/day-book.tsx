"use client";

import { useState } from "react";
import { SaveStatus } from "@/components/forms";
import { Bi, Panel } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { inr, niceDate } from "@/lib/format";

type Entry = {
  id: string;
  entry_no: string;
  kind: string;
  mode_code: string;
  amount: string;
  vehicle_no: string | null;
  slip_no: string | null;
  description: string | null;
  party: string | null;
  expense_name: string | null;
  entered_by_name: string;
  cancelled_reason: string | null;
};

const LABEL: Record<string, string> = {
  CREDIT_SALE: "Udhari given",
  CUSTOMER_REPAYMENT: "Udhari received",
  LUBE_SALE: "Lube sale",
  OTHER_INCOME: "Other income",
  LOAN_RECEIVED: "Loan received",
  OWNER_CAPITAL: "Owner put in",
  EXPENSE: "Expense",
  SUPPLIER_PAYMENT: "Paid to supplier",
  BANK_DEPOSIT: "Bank deposit",
  SALARY: "Salary",
  STAFF_ADVANCE: "Staff advance",
  OWNER_DRAWING: "Taken by owner",
  LOAN_REPAYMENT: "Loan repaid",
};
const IN = new Set(["CUSTOMER_REPAYMENT", "LUBE_SALE", "OTHER_INCOME", "LOAN_RECEIVED", "OWNER_CAPITAL"]);

/** Day book: every entry of the day, newest first. Owner can cancel a wrong one (with a reason). */
export function DayBook({ books, isOwner }: { books: Array<{ date: string; status: string; entries: Entry[] }>; isOwner: boolean }) {
  const [tab, setTab] = useState(books[books.length - 1].date);
  const book = books.find((b) => b.date === tab) ?? books[0];
  const { state, run } = useAction("/api/day");
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  return (
    <Panel
      title={<Bi en="Day book" hi="आज की प्रविष्टियाँ" />}
      right={
        books.length > 1 ? (
          <span className="flex gap-1">
            {books.map((b) => (
              <button key={b.date} type="button" onClick={() => setTab(b.date)} className={`rounded px-1.5 ${tab === b.date ? "bg-brand text-white" : "underline"}`}>
                {niceDate(b.date)}
              </button>
            ))}
          </span>
        ) : (
          niceDate(book.date)
        )
      }
    >
      <div className="max-h-96 overflow-auto">
        <table className="reg text-sm">
          <thead className="sticky top-0">
            <tr>
              <th>#</th>
              <th>Entry</th>
              <th className="text-right">In ₹</th>
              <th className="text-right">Out / Udhari ₹</th>
              {isOwner && book.status === "OPEN" && <th></th>}
            </tr>
          </thead>
          <tbody>
            {[...book.entries].reverse().map((e) => (
              <tr key={e.id} className={e.cancelled_reason ? "text-muted line-through" : ""}>
                <td className="text-muted">{e.entry_no}</td>
                <td>
                  {LABEL[e.kind] ?? e.kind}
                  {e.party && <b> · {e.party}</b>}
                  {e.expense_name && ` · ${e.expense_name}`}
                  {e.vehicle_no && <span className="text-muted"> · {e.vehicle_no}</span>}
                  {e.mode_code !== "CASH" && e.mode_code !== "CUSTOMER_CREDIT" && <span className="text-muted"> · {e.mode_code}</span>}
                  {e.description && <span className="text-muted"> · {e.description}</span>}
                  <span className="text-xs text-muted"> · {e.entered_by_name}</span>
                  {e.cancelled_reason && <span className="text-xs no-underline"> (cancelled: {e.cancelled_reason})</span>}
                </td>
                <td className="num">{IN.has(e.kind) ? inr(e.amount) : ""}</td>
                <td className="num">{IN.has(e.kind) ? "" : inr(e.amount)}</td>
                {isOwner && book.status === "OPEN" && (
                  <td>
                    {!e.cancelled_reason && (
                      <button type="button" className="text-xs text-red-700 underline" onClick={() => setCancelId(e.id)}>
                        cancel
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {book.entries.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted">
                  No entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {cancelId && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run({ action: "cancelEntry", entryId: cancelId, reason }, "Entry cancelled.")) {
              setCancelId(null);
              setReason("");
            }
          }}
        >
          <input className="inp flex-1" autoFocus placeholder="Why cancel? e.g. typed wrong amount" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn btn-danger" disabled={reason.trim().length < 5}>
            Cancel entry
          </button>
          <button type="button" className="btn-light" onClick={() => setCancelId(null)}>
            Keep
          </button>
        </form>
      )}
      <SaveStatus state={state} />
    </Panel>
  );
}
