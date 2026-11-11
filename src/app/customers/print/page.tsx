import { LedgerSheet } from "@/components/ledger-sheet";
import { Page } from "@/components/page";
import { pool } from "@/server/db";
import { currentBusinessDate } from "@/server/meters/service";
import { customerLedger, type Ledger } from "@/server/reports/service";
import { requireUser } from "@/server/session";
import { PrintButton } from "../[id]/print-button";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Every udhari customer's ledger, one per printed page. */
export default async function PrintAllLedgers({ searchParams }: PageProps<"/customers/print">) {
  await requireUser("customer.view_balance");
  const sp = await searchParams;
  const c = await pool().connect();
  try {
    const today = await currentBusinessDate(c);
    const span = (await c.query("SELECT min(business_date)::text f, max(business_date)::text l FROM journal_entries")).rows[0] as { f: string | null; l: string | null };
    const from = ISO.test(one(sp.from) ?? "") ? one(sp.from)! : (span.f ?? today);
    const to = ISO.test(one(sp.to) ?? "") ? one(sp.to)! : span.l && span.l > today ? span.l : today;
    const onlyDue = one(sp.only) !== "all";
    const ids = (
      await c.query(
        `SELECT p.id FROM parties p LEFT JOIN journal_lines l ON l.party_id = p.id LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.business_date <= $1
          WHERE p.kind = 'CUSTOMER' GROUP BY p.id, p.name
         HAVING $2::boolean = false OR COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.id IS NOT NULL), 0) <> 0
          ORDER BY lower(p.name)`,
        [to, onlyDue],
      )
    ).rows.map((r) => r.id as string);
    const ledgers: Ledger[] = [];
    for (const id of ids) ledgers.push(await customerLedger(c, id, { from, to }));
    const pump = (await c.query("SELECT name FROM sites WHERE active LIMIT 1")).rows[0]?.name ?? "";
    return (
      <Page title={`All customer ledgers (${ledgers.length})`} back="/customers" active="customers">
        <form className="no-print mb-3 flex flex-wrap items-end gap-2 rounded border border-line bg-surface p-3" action="/customers/print">
          <label>
            <span className="block text-xs text-muted">From</span>
            <input type="date" name="from" defaultValue={from} className="inp w-40" />
          </label>
          <label>
            <span className="block text-xs text-muted">To</span>
            <input type="date" name="to" defaultValue={to} className="inp w-40" />
          </label>
          <label>
            <span className="block text-xs text-muted">Customers</span>
            <select name="only" defaultValue={onlyDue ? "due" : "all"} className="inp w-48">
              <option value="due">With a balance only</option>
              <option value="all">Everyone</option>
            </select>
          </label>
          <button className="btn">Show</button>
          <span className="ml-auto flex gap-2">
            <a href={`/api/customers/excel?all=${onlyDue ? "due" : "all"}&from=${from}&to=${to}`} className="btn-light inline-flex items-center">
              ⬇ Excel (one sheet each)
            </a>
            <PrintButton />
          </span>
        </form>
        <div className="space-y-6">
          {ledgers.map((l) => (
            <LedgerSheet key={l.party.id} l={l} pump={pump} className="break-after-page" />
          ))}
          {ledgers.length === 0 && <div className="text-muted">No customers to print.</div>}
        </div>
      </Page>
    );
  } finally {
    c.release();
  }
}
