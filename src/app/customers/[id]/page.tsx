import { notFound } from "next/navigation";
import { Bi, Card } from "@/components/ui";
import { Page } from "@/components/page";
import { inr, niceDate } from "@/lib/format";
import { pool } from "@/server/db";
import { partyStatement } from "@/server/money/service";
import { requireUser } from "@/server/session";
import { currentBusinessDate } from "@/server/meters/service";
import { OldBalanceForm } from "./old-balance-form";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

const DESC: Record<string, string> = {
  CREDIT_SALE: "Fuel on udhari",
  CUSTOMER_REPAYMENT: "Payment received",
  OPENING_BALANCE: "Opening balance (old register)",
  REVERSAL: "Cancelled entry",
};

/** Customer statement: date, description, debit, credit, running balance, final outstanding. */
export default async function Statement({ params }: PageProps<"/customers/[id]">) {
  const user = await requireUser("customer.view_balance");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const c = await pool().connect();
  const s = await partyStatement(c, id).catch(() => null).finally(() => c.release());
  if (!s || s.party.kind !== "CUSTOMER") notFound();
  const site = await pool().query("SELECT name FROM sites LIMIT 1");
  const hasOpening = (await pool().query("SELECT 1 FROM opening_balances WHERE party_id = $1", [id])).rowCount;
  const c2 = await pool().connect();
  const today = await currentBusinessDate(c2).finally(() => c2.release());
  return (
    <Page title={<Bi en={s.party.name} hi="ग्राहक खाता" />} back="/customers">
      <Card className="print:border-0">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-sm text-muted">{site.rows[0]?.name} · Statement / खाता विवरण</div>
            <div className="text-base font-bold">{s.party.name}</div>
            <div className="text-sm text-muted">{s.party.phone ?? ""}</div>
          </div>
          <PrintButton />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-base">
            <thead>
              <tr className="border-b border-line text-left text-sm text-muted">
                <th className="py-1">Date</th>
                <th className="py-1">Details</th>
                <th className="py-1 text-right">Udhari (Dr)</th>
                <th className="py-1 text-right">Paid (Cr)</th>
                <th className="py-1 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l, i) => (
                <tr key={i} className="border-b border-line">
                  <td className="py-1 whitespace-nowrap">{niceDate(l.date)}</td>
                  <td className="py-1">
                    {DESC[l.source_type] ?? l.source_type}
                    {l.vehicle_no && <span className="text-sm text-muted"> · {l.vehicle_no}</span>}
                  </td>
                  <td className="py-1 text-right font-mono">{l.debit !== "0.00" ? inr(l.debit) : ""}</td>
                  <td className="py-1 text-right font-mono">{l.credit !== "0.00" ? inr(l.credit) : ""}</td>
                  <td className="py-1 text-right font-mono">{inr(l.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex justify-between text-base font-bold">
          <span>{s.balance.startsWith("-") ? "Advance with us / अग्रिम" : "Outstanding / बकाया"}</span>
          <span className="font-mono">{inr(s.balance.replace("-", ""))}</span>
        </div>
      </Card>
      {!hasOpening && user.permissions.includes("import.run") && <OldBalanceForm partyId={id} today={today} />}
    </Page>
  );
}
