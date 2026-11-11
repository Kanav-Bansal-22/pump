import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "./auth/service";
import { pool, withTx } from "./db";
import { AppError, Errors, fromDbError } from "./errors";
import { runIdempotent } from "./idempotency";

export const SESSION_COOKIE = "pump_session";

export type ApiOk<T> = { ok: true; data: T; replayed?: boolean };
export type ApiErr = { ok: false; error: { code: string; message: string; messageHi?: string } };

export function clientIp(req: NextRequest): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null;
}

export function isHttps(req: NextRequest): boolean {
  return req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
}

/** CSRF defence (with SameSite=Strict cookies): state-changing requests must come from our own page. */
export function checkOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) throw Errors.badOrigin();
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw Errors.badOrigin();
  }
  if (originHost !== host) throw Errors.badOrigin();
}

export async function sessionHours(c: PoolClient, role: string): Promise<number> {
  const r = await c.query("SELECT key, value #>> '{}' AS v FROM settings WHERE key IN ('employee_session_hours','owner_session_days')");
  const m = Object.fromEntries(r.rows.map((x) => [x.key, Number(x.v)]));
  return role === "OWNER" ? (m.owner_session_days || 7) * 24 : m.employee_session_hours || 12;
}

export function setSessionCookie(res: NextResponse, req: NextRequest, token: string, hours: number) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: isHttps(req),
    path: "/",
    maxAge: hours * 3600,
  });
}

export function errorResponse(e: unknown, requestId: string): NextResponse<ApiErr> {
  const app = e instanceof AppError ? e : fromDbError(e);
  if (app) {
    return NextResponse.json(
      { ok: false, error: { code: app.code, message: app.message, messageHi: app.messageHi } },
      { status: app.status },
    );
  }
  console.error(`[${requestId}]`, e);
  // best effort error log; never let logging failure hide the response
  pool()
    .query("INSERT INTO app_errors (level, message, detail, request_id) VALUES ('error', $1, $2, $3)", [
      e instanceof Error ? e.message.slice(0, 500) : "unknown",
      e instanceof Error ? (e.stack ?? "").slice(0, 4000) : null,
      requestId,
    ])
    .catch(() => {});
  return NextResponse.json(
    { ok: false, error: { code: "SERVER_ERROR", message: `Not saved. Server error (ref ${requestId.slice(0, 8)}).`, messageHi: "सेव नहीं हुआ। सर्वर त्रुटि।" } },
    { status: 500 },
  );
}

type Handler<I, O> = (ctx: { c: PoolClient; user: SessionUser; input: I; req: NextRequest; requestId: string }) => Promise<O>;

/**
 * Wraps an authenticated JSON POST route:
 * origin check -> session -> permission -> zod validation -> one DB transaction (with audit context)
 * -> optional idempotency (header "Idempotency-Key") -> { ok, data } or { ok:false, error }.
 */
export function apiPost<S extends z.ZodType, O>(
  opts: { permission?: string; input: S; idempotent?: boolean; endpoint: string },
  handler: Handler<z.infer<S>, O>,
) {
  return async (req: NextRequest): Promise<NextResponse<ApiOk<O> | ApiErr>> => {
    const requestId = randomUUID();
    try {
      checkOrigin(req);
      const token = req.cookies.get(SESSION_COOKIE)?.value;
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        throw Errors.badInput("Request body is not valid.");
      }
      const parsed = opts.input.safeParse(body);
      if (!parsed.success) throw Errors.badInput(parsed.error.issues.map((i) => i.message).join("; "));

      const result = await withTx({ userId: null, requestId, ip: clientIp(req) }, async (c) => {
        const user = await getSessionUser(c, token);
        if (!user) throw Errors.notLoggedIn();
        await c.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
        if (user.mustChangePassword && opts.endpoint !== "auth.change-password")
          throw new AppError("MUST_CHANGE_PASSWORD", 403, "Please set a new password first.", "पहले नया पासवर्ड बनाएँ।");
        if (opts.permission && !user.permissions.includes(opts.permission)) throw Errors.forbidden();
        const run = () => handler({ c, user, input: parsed.data, req, requestId });
        if (!opts.idempotent) return { replayed: false, response: await run() };
        return runIdempotent(c, { key: req.headers.get("idempotency-key"), userId: user.id, endpoint: opts.endpoint, body: parsed.data }, run);
      });
      return NextResponse.json({ ok: true, data: result.response, ...(result.replayed ? { replayed: true } : {}) });
    } catch (e) {
      return errorResponse(e, requestId);
    }
  };
}
