import Link from "next/link";
import { Bi, Card, Page } from "@/components/ui";
import { inr, niceDate } from "@/lib/format";
import { pool } from "@/server/db";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

/** Udhari page: every customer with what they owe (positive) or have paid in advance (negative). */
export default async function UdhariList({ searchParams }: PageProps<"/udhari">) {
  await requireUser("customer.view_balance");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const c = await pool().connect();
  try {
    const rows = (
      await c.query(
        `SELECT p.id, p.name, p.phone,
                COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.source_type = 'OPENING_BALANCE'), 0)::numeric(14,2)::text AS opening,
                COALESCE(SUM(l.debit) FILTER (WHERE e.source_type = 'CREDIT_SALE'), 0)::numeric(14,2)::text AS given,
                COALESCE(SUM(l.credit) FILTER (WHERE e.source_type = 'CUSTOMER_REPAYMENT'), 0)::numeric(14,2)::text AS received,
                COALESCE(SUM(l.debit - l.credit), 0)::numeric(14,2)::text AS balance,
                MAX(e.business_date)::text AS last_date
           FROM parties p
           LEFT JOIN journal_lines l ON l.party_id = p.id
           LEFT JOIN journal_entries e ON e.id = l.entry_id
          WHERE p.kind = 'CUSTOMER' AND ($1 = '' OR p.name ILIKE '%' || $1 || '%' OR p.phone LIKE $1 || '%')
          GROUP BY p.id ORDER BY COALESCE(SUM(l.debit - l.credit), 0) DESC, lower(p.name)`,
        [q],
      )
    ).rows;
    const total = (await c.query(
      "SELECT COALESCE(SUM(l.debit - l.credit),0)::numeric(14,2)::text AS t FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1400'",
    )).rows[0].t as string;
    return (
      <Page title={<Bi en="Udhari (customer credit)" hi="उधारी खाता" />} back="/">
        <Card className="mb-4">
          <div className="text-base">Total outstanding / कुल बकाया</div>
          <div className="font-mono text-3xl font-bold">{inr(total)}</div>
          <div className="mt-1 text-sm text-muted">
            Includes old register balances only after they are imported (Owner → Import old udhari).
          </div>
        </Card>
        <form className="mb-4" action="/udhari">
          <input name="q" defaultValue={q} placeholder="Search name or phone / नाम खोजें" className="w-full rounded-xl border-2 border-line bg-white px-4 py-3 text-lg text-black" />
        </form>
        <div className="space-y-2">
          {rows.map((r) => (
            <Link key={r.id} href={`/udhari/${r.id}`} className="block rounded-2xl border border-line bg-surface p-4 active:scale-[0.99]">
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-bold">{r.name}</span>
                <span className={`font-mono text-lg font-bold ${r.balance.startsWith("-") ? "text-green-700" : ""}`}>
                  {r.balance.startsWith("-") ? `Advance ${inr(r.balance.slice(1))}` : inr(r.balance)}
                </span>
              </div>
              <div className="text-sm text-muted">
                {r.phone ?? "no phone"} · given {inr(r.given)} · received {inr(r.received)}
                {r.opening !== "0.00" && <> · opening {r.opening.startsWith("-") ? `advance ${inr(r.opening.slice(1))}` : inr(r.opening)}</>}
                {r.last_date && <> · last {niceDate(r.last_date)}</>}
              </div>
            </Link>
          ))}
          {rows.length === 0 && <div className="text-muted">No customers found.</div>}
        </div>
      </Page>
    );
  } finally {
    c.release();
  }
}
