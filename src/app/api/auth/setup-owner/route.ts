import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createFirstOwner, createSession } from "@/server/auth/service";
import { withTx } from "@/server/db";
import { Errors } from "@/server/errors";
import { checkOrigin, clientIp, errorResponse, sessionHours, setSessionCookie } from "@/server/http";

const Input = z.object({ name: z.string().max(80), username: z.string().max(64), password: z.string().max(128) });

/** First run only: creates the owner account. Refused once any user exists. */
export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  try {
    checkOrigin(req);
    const parsed = Input.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw Errors.badInput();
    const out = await withTx({ userId: null, requestId, ip: clientIp(req) }, async (c) => {
      const id = await createFirstOwner(c, parsed.data);
      await c.query("SELECT set_config('app.user_id', $1, true)", [id]);
      const hours = await sessionHours(c, "OWNER");
      const token = await createSession(c, id, { ip: clientIp(req), userAgent: req.headers.get("user-agent"), hours });
      return { token, hours };
    });
    const res = NextResponse.json({ ok: true, data: {} });
    setSessionCookie(res, req, out.token, out.hours);
    return res;
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
