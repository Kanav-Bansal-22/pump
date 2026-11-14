import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { Bi, Panel, Shell } from "@/components/ui";
import { inr, niceDate } from "@/lib/format";
import { pool } from "@/server/db";
import { customerList, entryDates, myUpiPayments, typeEachUpi } from "@/server/money/service";
import { requireUser } from "@/server/session";
import { NewCustomer } from "../register/new-customer";
import { Udhari } from "../register/udhari";
import { MyUpi } from "./my-upi";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = {
  CREDIT_SALE: "Udhari given",
  CUSTOMER_REPAYMENT: "Udhari received",
  EXPENSE: "Expense",
  LUBE_SALE: "Lube",
  OTHER_INCOME: "Other income",
  SUPPLIER_PAYMENT: "Payment",
  BANK_DEPOSIT: "Bank deposit",
};

/** Employee's phone: two jobs only. Udhari given/received, and "my UPI total so far". */
export default async function StaffPage() {
  const user = await requireUser();
  const c = await pool().connect();
  try {
    const site = (await c.query("SELECT id, name FROM sites WHERE active LIMIT 1")).rows[0];
    if (!site) {
      return (
        <Shell user={user}>
          <Panel title="Not ready">Ask the owner to set up the pump.</Panel>
        </Shell>
      );
    }
    const dates = await entryDates(c);
    const customers = await customerList(c);
    const upi = await myUpiPayments(c, site.id, dates.today, user.id);
    const upiOn = await typeEachUpi(c);
    const mine = (
      await c.query(
        `SELECT m.entry_no::text AS no, m.kind, m.amount::text AS amount, m.mode_code AS mode, m.vehicle_no AS vehicle, p.name AS party, m.entered_at AS at,
                (r.money_entry_id IS NOT NULL) AS cancelled
           FROM money_entries m LEFT JOIN parties p ON p.id = m.party_id LEFT JOIN money_entry_reversals r ON r.money_entry_id = m.id
          WHERE m.site_id = $1 AND m.entered_by = $2 AND m.business_date >= $3
          ORDER BY m.entered_at DESC LIMIT 15`,
        [site.id, user.id, dates.yesterday ?? dates.today],
      )
    ).rows;

    return (
      <Shell user={user} pump={site.name} active="staff">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-lg font-bold">
            {user.name} · <span className="text-accent">{niceDate(dates.today)}</span>
          </h1>
          <AutoRefresh />
        </div>
        <div className="space-y-3">
          <Udhari customers={customers} dates={dates} />
          <NewCustomer dates={dates} />
          <MyUpi date={dates.today} totals={upi.totals} payments={upi.payments} upiOn={upiOn} />
          <Panel title={<Bi en="My entries" hi="मेरी एंट्री" />} right={<Link href="/customers" className="underline">all customers</Link>}>
            {mine.length === 0 ? (
              <p className="text-sm text-muted">Nothing entered by you yet.</p>
            ) : (
              <table className="reg text-sm">
                <tbody>
                  {mine.map((e) => (
                    <tr key={e.no} className={e.cancelled ? "line-through opacity-60" : ""}>
                      <td className="text-muted">#{e.no}</td>
                      <td>
                        {e.party ?? ""} <span className="text-xs text-muted">{KIND[e.kind] ?? e.kind}{e.vehicle ? ` · ${e.vehicle}` : ""}</span>
                      </td>
                      <td className="num">{inr(e.amount)}</td>
                      <td className="whitespace-nowrap text-xs text-muted">
                        {new Date(e.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-1.5 text-xs text-muted">A wrong entry? Tell the owner; only the owner can cancel it.</p>
          </Panel>
        </div>
      </Shell>
    );
  } finally {
    c.release();
  }
}
