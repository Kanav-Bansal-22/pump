import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { getSessionUser } from "@/server/auth/service";
import { withTx } from "@/server/db";
import { Errors } from "@/server/errors";
import { SESSION_COOKIE, clientIp, errorResponse } from "@/server/http";
import { statementXlsx } from "@/server/reports/excel";
import { periodStatement } from "@/server/reports/service";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Owner: download the period statement as Excel. */
export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  try {
    const sp = req.nextUrl.searchParams;
    const from = sp.get("from") ?? "";
    const to = sp.get("to") ?? "";
    if (!ISO.test(from) || !ISO.test(to)) throw Errors.badInput("Choose the period.");
    const label = (sp.get("label") ?? `${from} to ${to}`).slice(0, 60);
    const s = await withTx({ userId: null, requestId, ip: clientIp(req) }, async (c) => {
      const u = await getSessionUser(c, req.cookies.get(SESSION_COOKIE)?.value);
      if (!u) throw Errors.notLoggedIn();
      if (!u.permissions.includes("report.financial")) throw Errors.forbidden();
      return periodStatement(c, { from, to });
    });
    const buf = await statementXlsx(s, label);
    const file = from === to ? `statement-${from}.xlsx` : `statement-${from}-to-${to}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${file}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
