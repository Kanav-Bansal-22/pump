import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { loginWithPassword } from "@/server/auth/service";
import { withTx } from "@/server/db";
import { Errors } from "@/server/errors";
import { checkOrigin, clientIp, errorResponse, sessionHours, setSessionCookie } from "@/server/http";

const Input = z.object({ username: z.string().max(64), password: z.string().max(128) });

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  try {
    checkOrigin(req);
    const parsed = Input.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw Errors.badInput();
    const out = await withTx({ userId: null, requestId, ip: clientIp(req) }, async (c) => {
      const role = await c.query("SELECT role_code FROM users WHERE username = lower($1)", [parsed.data.username.trim()]);
      const hours = await sessionHours(c, role.rows[0]?.role_code ?? "STAFF");
      const r = await loginWithPassword(c, { ...parsed.data, ip: clientIp(req), userAgent: req.headers.get("user-agent"), sessionHours: hours });
      return { r, hours };
    });
    if (!out.r.ok) return errorResponse(out.r.error, requestId);
    const res = NextResponse.json({ ok: true, data: { mustChangePassword: out.r.mustChangePassword } });
    setSessionCookie(res, req, out.r.token, out.hours);
    return res;
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
