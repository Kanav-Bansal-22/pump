import { notFound } from "next/navigation";
import { LedgerSheet } from "@/components/ledger-sheet";
import { Page } from "@/components/page";
import { pool } from "@/server/db";
import { currentBusinessDate } from "@/server/meters/service";
import { customerLedger } from "@/server/reports/service";
import { requireUser } from "@/server/session";
import { OldBalanceForm } from "./old-balance-form";
import { PrintButton } from "./print-button";
import { RemoveCustomer } from "./remove-customer";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** One customer's full record (default) or a chosen period, with print / PDF and Excel. */
export default async function CustomerLedgerPage({ params, searchParams }: PageProps<"/customers/[id]">) {
  const user = await requireUser("customer.view_balance");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sp = await searchParams;
  const c = await pool().connect();
  try {
    const today = await currentBusinessDate(c);
    const span = (
      await c.query(
        "SELECT min(e.business_date)::text f, max(e.business_date)::text l FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.party_id = $1",
        [id],
      )
    ).rows[0] as { f: string | null; l: string | null };
    // "full record" = first entry to the later of today and the last entry
    const from = ISO.test(one(sp.from) ?? "") ? one(sp.from)! : (span.f ?? today);
    const to = ISO.test(one(sp.to) ?? "") ? one(sp.to)! : span.l && span.l > today ? span.l : today;
    const l = await customerLedger(c, id, { from, to }).catch(() => null);
    if (!l) notFound();
    const pump = (await c.query("SELECT name FROM sites WHERE active LIMIT 1")).rows[0]?.name ?? "";
    const hasOpening = (await c.query("SELECT 1 FROM opening_balances WHERE party_id = $1", [id])).rowCount;
    const pos = (
      await c.query(
        `SELECT p.active, p.remarks,
                (SELECT o.amount::text FROM opening_balances o
                  WHERE o.party_id = p.id AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = o.journal_entry_id)) AS opening,
                (SELECT COALESCE(SUM(debit - credit), 0)::numeric(14,2)::text FROM journal_lines WHERE party_id = p.id) AS balance
           FROM parties p WHERE p.id = $1`,
        [id],
      )
    ).rows[0] as { active: boolean; remarks: string | null; opening: string | null; balance: string };
    return (
      <Page title={l.party.name} back="/customers" active="customers">
        {!pos.active && (
          <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
            Removed customer: not shown in lists. {pos.remarks}
          </div>
        )}
        <form className="no-print mb-3 flex flex-wrap items-end gap-2 rounded border border-line bg-surface p-3" action={`/customers/${id}`}>
          <label>
            <span className="block text-xs text-muted">From</span>
            <input type="date" name="from" defaultValue={from} className="inp w-40" />
          </label>
          <label>
            <span className="block text-xs text-muted">To</span>
            <input type="date" name="to" defaultValue={to} className="inp w-40" />
          </label>
          <button className="btn">Show</button>
          <a href={`/customers/${id}`} className="btn-light inline-flex items-center">
            Full record
          </a>
          <span className="ml-auto flex gap-2">
            <a href={`/api/customers/excel?id=${id}&from=${from}&to=${to}`} className="btn-light inline-flex items-center">
              ⬇ Excel
            </a>
            <PrintButton />
          </span>
        </form>
        <LedgerSheet l={l} pump={pump} />
        {!hasOpening && pos.active && user.permissions.includes("import.run") && <OldBalanceForm partyId={id} today={today} />}
        {pos.active && user.role === "OWNER" && <RemoveCustomer partyId={id} name={l.party.name} opening={pos.opening} balance={pos.balance} />}
      </Page>
    );
  } finally {
    c.release();
  }
}
