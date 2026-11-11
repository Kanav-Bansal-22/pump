import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { revokeSession } from "@/server/auth/service";
import { withTx } from "@/server/db";
import { SESSION_COOKIE, checkOrigin, clientIp, errorResponse } from "@/server/http";

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  try {
    checkOrigin(req);
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (token) await withTx({ userId: null, requestId, ip: clientIp(req) }, (c) => revokeSession(c, token));
    const res = NextResponse.json({ ok: true, data: {} });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
