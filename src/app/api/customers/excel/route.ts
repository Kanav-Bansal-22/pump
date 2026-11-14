import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { getSessionUser } from "@/server/auth/service";
import { withTx } from "@/server/db";
import { Errors } from "@/server/errors";
import { SESSION_COOKIE, clientIp, errorResponse } from "@/server/http";
import { ledgersXlsx } from "@/server/reports/excel";
import { customerLedger, type Ledger } from "@/server/reports/service";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Customer ledger(s) as Excel: ?id=<customer> or ?all=due|all, with from / to. */
export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  try {
    const sp = req.nextUrl.searchParams;
    const from = sp.get("from") ?? "";
    const to = sp.get("to") ?? "";
    if (!ISO.test(from) || !ISO.test(to)) throw Errors.badInput("Choose the period.");
    const id = sp.get("id");
    const all = sp.get("all");
    const { pump, ledgers } = await withTx({ userId: null, requestId, ip: clientIp(req) }, async (c) => {
      const u = await getSessionUser(c, req.cookies.get(SESSION_COOKIE)?.value);
      if (!u) throw Errors.notLoggedIn();
      if (!u.permissions.includes("customer.view_balance")) throw Errors.forbidden();
      let ids: string[];
      if (id && /^[0-9a-f-]{36}$/.test(id)) ids = [id];
      else if (all === "due" || all === "all")
        ids = (
          await c.query(
            `SELECT p.id FROM parties p LEFT JOIN journal_lines l ON l.party_id = p.id LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.business_date <= $1
              WHERE p.kind = 'CUSTOMER' GROUP BY p.id, p.name, p.active
             HAVING (p.active OR COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.id IS NOT NULL), 0) <> 0) AND ($2::boolean = false OR COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.id IS NOT NULL), 0) <> 0) ORDER BY lower(p.name)`,
            [to, all === "due"],
          )
        ).rows.map((r) => r.id as string);
      else throw Errors.badInput("Which customer?");
      const ledgers: Ledger[] = [];
      for (const x of ids) ledgers.push(await customerLedger(c, x, { from, to }));
      const pump = (await c.query("SELECT name FROM sites WHERE active LIMIT 1")).rows[0]?.name ?? "";
      return { pump, ledgers };
    });
    const buf = await ledgersXlsx(pump, ledgers);
    const name = ledgers.length === 1 ? `ledger-${ledgers[0].party.name.replace(/[^\w-]+/g, "_")}` : "ledgers-all";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${name}-${from}-to-${to}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
