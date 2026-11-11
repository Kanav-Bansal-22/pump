import { inr, niceDate } from "@/lib/format";
import { drcr, type Ledger } from "@/server/reports/service";

/** A customer's ledger as an accountant prints it: b/f, Dr / Cr / balance, closing balance. */
export function LedgerSheet({ l, pump, className = "" }: { l: Ledger; pump: string; className?: string }) {
  const outstanding = l.closing.startsWith("-") ? "Advance with us" : "Outstanding (due from customer)";
  return (
    <section className={`rounded border border-line bg-surface p-4 print:border-0 print:p-0 ${className}`}>
      <div className="mb-3 border-b-2 border-brand pb-2 text-center">
        <div className="text-lg font-bold">{pump}</div>
        <div className="font-semibold">Ledger account: {l.party.name}</div>
        <div className="text-sm text-muted">
          {[l.party.phone, l.party.address].filter(Boolean).join(" · ")}
          {(l.party.phone || l.party.address) && " · "}
          {niceDate(l.period.from)} to {niceDate(l.period.to)}
        </div>
      </div>
      <table className="reg text-sm">
        <thead>
          <tr>
            <th className="w-28">Date</th>
            <th>Particulars</th>
            <th className="text-right">Debit ₹</th>
            <th className="text-right">Credit ₹</th>
            <th className="text-right">Balance ₹</th>
          </tr>
        </thead>
        <tbody>
          <tr className="font-semibold">
            <td>{niceDate(l.period.from)}</td>
            <td>Balance brought forward (b/f)</td>
            <td></td>
            <td></td>
            <td className="num">{drcr(l.broughtForward)}</td>
          </tr>
          {l.lines.map((x, i) => (
            <tr key={i}>
              <td className="whitespace-nowrap">{niceDate(x.date)}</td>
              <td>
                {x.particulars}
                {x.detail && <span className="text-xs text-muted"> · {x.detail}</span>}
              </td>
              <td className="num">{x.debit !== "0.00" ? inr(x.debit).replace("₹", "") : ""}</td>
              <td className="num">{x.credit !== "0.00" ? inr(x.credit).replace("₹", "") : ""}</td>
              <td className="num">{drcr(x.balance)}</td>
            </tr>
          ))}
          {l.lines.length === 0 && (
            <tr>
              <td></td>
              <td colSpan={4} className="text-muted">
                No entries in this period.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="bg-soft font-semibold">
            <td></td>
            <td>Total for the period</td>
            <td className="num">{inr(l.debit).replace("₹", "")}</td>
            <td className="num">{inr(l.credit).replace("₹", "")}</td>
            <td></td>
          </tr>
          <tr className="font-bold">
            <td>{niceDate(l.period.to)}</td>
            <td>Closing balance (c/f) · {outstanding}</td>
            <td></td>
            <td></td>
            <td className="num">{drcr(l.closing)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="mt-6 flex justify-between text-xs text-muted">
        <span>Dr = amount due from the customer · Cr = advance paid by the customer</span>
        <span>For {pump}: ____________________</span>
      </div>
    </section>
  );
}
