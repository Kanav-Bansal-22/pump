import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { revokeSession } from "@/server/auth/service";
import { withTx } from "@/server/db";
import { SESSION_COOKIE, checkOrigin, clientIp } from "@/server/http";

/** Plain form POST from the top bar's "Log out" button. */
export async function POST(req: NextRequest) {
  try {
    checkOrigin(req);
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (token) await withTx({ userId: null, requestId: randomUUID(), ip: clientIp(req) }, (c) => revokeSession(c, token));
  } catch {
    // fall through: always clear the cookie and go to the login page
  }
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
