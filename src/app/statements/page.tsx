import Link from "next/link";
import { Page } from "@/components/page";
import { Panel } from "@/components/ui";
import { inr, niceDate, num } from "@/lib/format";
import { pool } from "@/server/db";
import { currentBusinessDate } from "@/server/meters/service";
import { ENTRY_KINDS } from "@/server/money/service";
import { drcr, periodFrom, periodStatement } from "@/server/reports/service";
import { requireUser } from "@/server/session";
import { PrintButton } from "../customers/[id]/print-button";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Statements for a day, a month or any period, laid out as an accountant would report them. */
export default async function StatementsPage({ searchParams }: PageProps<"/statements">) {
  await requireUser("report.financial");
  const sp = await searchParams;
  const c = await pool().connect();
  try {
    const today = await currentBusinessDate(c);
    const per = periodFrom({ type: one(sp.type), date: one(sp.date), month: one(sp.month), from: one(sp.from), to: one(sp.to) }, today);
    const s = await periodStatement(c, per);
    const t = s.totals;
    const excel = `/api/statements/excel?from=${per.from}&to=${per.to}&label=${encodeURIComponent(per.label)}`;
    const amt = (v: string | null | undefined) => (v && v !== "0.00" ? inr(v) : "–");

    return (
      <Page title="Statements · हिसाब विवरण" active="statements" wide>
        {/* period chooser */}
        <form className="no-print mb-3 flex flex-wrap items-end gap-2 rounded border border-line bg-surface p-3" action="/statements">
          <label>
            <span className="block text-xs text-muted">Statement</span>
            <select name="type" defaultValue={per.type} className="inp w-32">
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
              <option value="custom">From – To</option>
            </select>
          </label>
          <label>
            <span className="block text-xs text-muted">Day (daily)</span>
            <input type="date" name="date" defaultValue={per.type === "daily" ? per.from : today} className="inp w-40" />
          </label>
          <label>
            <span className="block text-xs text-muted">Month (monthly)</span>
            <input type="month" name="month" defaultValue={per.type === "monthly" ? per.from.slice(0, 7) : today.slice(0, 7)} className="inp w-40" />
          </label>
          <label>
            <span className="block text-xs text-muted">From</span>
            <input type="date" name="from" defaultValue={per.type === "custom" ? per.from : today.slice(0, 8) + "01"} className="inp w-40" />
          </label>
          <label>
            <span className="block text-xs text-muted">To</span>
            <input type="date" name="to" defaultValue={per.type === "custom" ? per.to : today} className="inp w-40" />
          </label>
          <button className="btn">Show</button>
          <span className="ml-auto flex gap-2">
            <a href={excel} className="btn-light inline-flex items-center">
              ⬇ Excel
            </a>
            <PrintButton />
          </span>
        </form>

        {/* heading, as on a printed statement */}
        <div className="mb-3 border-b-2 border-brand pb-2 text-center">
          <div className="text-xl font-bold">{s.pump.name}</div>
          {s.pump.address && <div className="text-sm text-muted">{s.pump.address}</div>}
          <div className="mt-1 text-base font-semibold">
            Statement of Accounts · {per.type === "daily" ? "Day" : per.type === "monthly" ? "Month" : "Period"}: {per.label}
          </div>
          <div className="text-xs text-muted">Generated {new Date(s.generatedAt).toLocaleString("en-IN")} · amounts in ₹</div>
          {s.notEnded.length > 0 && (
            <div className="mt-1 text-xs font-semibold text-orange-700">
              Not yet ended (figures may still change): {s.notEnded.map(niceDate).join(", ")}
            </div>
          )}
        </div>

        {s.days.length === 0 ? (
          <Panel title="Nothing recorded">No entries or readings in this period.</Panel>
        ) : (
          <div className="space-y-3">
            {/* 1. summary */}
            <div className="grid gap-3 lg:grid-cols-2 [&>*]:min-w-0">
              <Panel title="1. Sales & income">
                <table className="reg">
                  <thead>
                    <tr>
                      <th>Particulars</th>
                      <th className="text-right">Litres</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Petrol (MS) sales</td>
                      <td className="num">{num(t.petrolL)}</td>
                      <td className="num">{inr(t.petrol)}</td>
                    </tr>
                    <tr>
                      <td>Diesel (HSD) sales</td>
                      <td className="num">{num(t.dieselL)}</td>
                      <td className="num">{inr(t.diesel)}</td>
                    </tr>
                    <tr className="font-semibold">
                      <td>Total fuel sales</td>
                      <td></td>
                      <td className="num">{inr(t.fuelSales)}</td>
                    </tr>
                    {s.incomeHeads.map((h) => (
                      <tr key={h.head}>
                        <td>{h.head}</td>
                        <td></td>
                        <td className="num">{inr(h.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
              <Panel title="2. How the fuel sales were received">
                <table className="reg">
                  <tbody>
                    <tr>
                      <td>Cash</td>
                      <td className="num">{inr(t.cashSales)}</td>
                    </tr>
                    <tr>
                      <td>UPI</td>
                      <td className="num">{inr(t.upi)}</td>
                    </tr>
                    <tr>
                      <td>Card</td>
                      <td className="num">{inr(t.card)}</td>
                    </tr>
                    <tr>
                      <td>Bank / other</td>
                      <td className="num">{inr(t.bankOther)}</td>
                    </tr>
                    <tr>
                      <td>Credit (udhari given)</td>
                      <td className="num">{inr(t.udhariGiven)}</td>
                    </tr>
                    <tr className="font-semibold">
                      <td>Total = fuel sales</td>
                      <td className="num">{inr(t.fuelSales)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="mt-2 text-xs text-muted">Udhari received in the period: {inr(t.udhariReceived)} (collection of old credit, not new sales)</div>
              </Panel>
            </div>

            {/* 2. day-wise register */}
            <Panel title="3. Day-wise register">
              <div className="overflow-x-auto">
                <table className="reg min-w-[64rem] text-sm">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="text-right">Petrol L</th>
                      <th className="text-right">Diesel L</th>
                      <th className="text-right">Fuel sales</th>
                      <th className="text-right">Udhari given</th>
                      <th className="text-right">UPI / card / bank</th>
                      <th className="text-right">Cash sales</th>
                      <th className="text-right">Udhari recd</th>
                      <th className="text-right">Lube / other</th>
                      <th className="text-right">Exp. cash</th>
                      <th className="text-right">Exp. UPI/bank</th>
                      <th className="text-right">Cash expected</th>
                      <th className="text-right">Counted</th>
                      <th className="text-right">Short (−) / excess</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.days.map((d) => (
                      <tr key={d.date}>
                        <td className="whitespace-nowrap">
                          <Link href={`/days/${d.date}`} className="text-accent hover:underline">
                            {niceDate(d.date)}
                          </Link>
                          {d.status !== "LOCKED" && <span className="ml-1 text-xs text-orange-700">open</span>}
                        </td>
                        <td className="num">{num(d.petrolL)}</td>
                        <td className="num">{num(d.dieselL)}</td>
                        <td className="num">{amt(d.fuelSales)}</td>
                        <td className="num">{amt(d.udhariGiven)}</td>
                        <td className="num">{amt(d.nonCash)}</td>
                        <td className="num">{amt(d.cashSales)}</td>
                        <td className="num">{amt(d.udhariReceived)}</td>
                        <td className="num">{amt(d.otherIncome)}</td>
                        <td className="num">{amt(d.expensesCash)}</td>
                        <td className="num">{amt(d.expensesOther)}</td>
                        <td className="num">{amt(d.expectedCash)}</td>
                        <td className="num">{amt(d.counted)}</td>
                        <td className={`num ${d.difference && d.difference.startsWith("-") ? "text-red-700" : ""}`}>{d.difference == null ? "" : d.difference === "0.00" ? "✓" : inr(d.difference)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-soft font-semibold">
                      <td>Total</td>
                      <td className="num">{num(t.petrolL)}</td>
                      <td className="num">{num(t.dieselL)}</td>
                      <td className="num">{inr(t.fuelSales)}</td>
                      <td className="num">{inr(t.udhariGiven)}</td>
                      <td className="num">{inr(t.nonCash)}</td>
                      <td className="num">{inr(t.cashSales)}</td>
                      <td className="num">{inr(t.udhariReceived)}</td>
                      <td className="num">{inr(t.otherIncome)}</td>
                      <td className="num">{inr(t.expensesCash)}</td>
                      <td className="num">{inr(t.expensesOther)}</td>
                      <td className="num">{inr(t.expectedCash)}</td>
                      <td className="num">{inr(t.counted)}</td>
                      <td className={`num ${t.difference.startsWith("-") ? "text-red-700" : ""}`}>{inr(t.difference)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Panel>

            <div className="grid gap-3 lg:grid-cols-2 [&>*]:min-w-0">
              {/* 3. expenses */}
              <Panel title="4. Expenses & payments by head">
                <table className="reg text-sm">
                  <thead>
                    <tr>
                      <th>Head</th>
                      <th className="text-right">Cash</th>
                      <th className="text-right">UPI / bank</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.expenseHeads.map((h) => (
                      <tr key={h.head}>
                        <td>{h.head}</td>
                        <td className="num">{amt(h.cash)}</td>
                        <td className="num">{amt(h.other)}</td>
                        <td className="num">{inr(h.total)}</td>
                      </tr>
                    ))}
                    {s.expenseHeads.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-muted">
                          No expenses.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-soft font-semibold">
                      <td>Total</td>
                      <td className="num">{inr(t.expensesCash)}</td>
                      <td className="num">{inr(t.expensesOther)}</td>
                      <td className="num">{inr(s.expenseTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </Panel>

              {/* 4. cash book */}
              <Panel title="5. Cash book (drawer + cash with owner)">
                <table className="reg text-sm">
                  <thead>
                    <tr>
                      <th>Particulars</th>
                      <th className="text-right">Receipts</th>
                      <th className="text-right">Payments</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="font-semibold">
                      <td>Opening cash (b/f)</td>
                      <td className="num">{inr(s.cash.opening)}</td>
                      <td></td>
                    </tr>
                    {s.cash.lines.map((l) => (
                      <tr key={l.label}>
                        <td>{l.label}</td>
                        <td className="num">{amt(l.receipts)}</td>
                        <td className="num">{amt(l.payments)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-soft font-semibold">
                      <td>Closing cash (c/f)</td>
                      <td></td>
                      <td className="num">{inr(s.cash.closing)}</td>
                    </tr>
                  </tfoot>
                </table>
                <div className="mt-1 text-xs text-muted">Only ended days are in the cash book (a day&apos;s cash sales are posted when it is ended).</div>
              </Panel>
            </div>

            {/* 5. debtors */}
            <Panel title="6. Udhari (debtors) summary" right={<Link href={`/customers/print?from=${per.from}&to=${per.to}`} className="no-print underline">print every customer&apos;s ledger</Link>}>
              <div className="overflow-x-auto">
                <table className="reg min-w-[40rem] text-sm">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th className="text-right">Opening</th>
                      <th className="text-right">Debit (given)</th>
                      <th className="text-right">Credit (received)</th>
                      <th className="text-right">Closing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.debtors.rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <Link href={`/customers/${r.id}?from=${per.from}&to=${per.to}`} className="text-accent hover:underline">
                            {r.name}
                          </Link>
                        </td>
                        <td className="num">{drcr(r.opening)}</td>
                        <td className="num">{amt(r.debit)}</td>
                        <td className="num">{amt(r.credit)}</td>
                        <td className="num font-semibold">{drcr(r.closing)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-soft font-semibold">
                      <td>Total</td>
                      <td className="num">{drcr(s.debtors.opening)}</td>
                      <td className="num">{inr(s.debtors.debit)}</td>
                      <td className="num">{inr(s.debtors.credit)}</td>
                      <td className="num">{drcr(s.debtors.closing)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Panel>

            {/* 6. day book */}
            <Panel title={`7. Day book (${s.dayBook.length} entries)`} className="break-before-page">
              <table className="reg text-sm">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>#</th>
                    <th>Particulars</th>
                    <th>Mode</th>
                    <th className="text-right">Amount</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {s.dayBook.map((e) => (
                    <tr key={e.entry_no} className={e.cancelled ? "text-muted line-through" : ""}>
                      <td className="whitespace-nowrap">{niceDate(e.date)}</td>
                      <td className="text-muted">{e.entry_no}</td>
                      <td>
                        {ENTRY_KINDS[e.kind].en}
                        {e.party && <b> · {e.party}</b>}
                        {e.head && ` · ${e.head}`}
                        {e.vehicle_no && <span className="text-muted"> · {e.vehicle_no}</span>}
                        {e.description && <span className="text-muted"> · {e.description}</span>}
                        {e.cancelled && " (cancelled)"}
                      </td>
                      <td className="text-muted">{e.mode === "CUSTOMER_CREDIT" ? "udhari" : e.mode.toLowerCase().replace("_", " ")}</td>
                      <td className="num">{inr(e.amount)}</td>
                      <td className="text-muted">{e.by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
            <div className="pt-6 text-right text-sm">
              Checked by: ____________________ &nbsp; Owner&apos;s signature: ____________________
            </div>
          </div>
        )}
      </Page>
    );
  } finally {
    c.release();
  }
}
