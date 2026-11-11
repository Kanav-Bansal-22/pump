import { createHash } from "node:crypto";
import type { ClientBase } from "pg";
import { Blocked, Errors } from "./errors";

const KEY_RE = /^[A-Za-z0-9_-]{16,100}$/;

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]));
  return v;
}

export function requestHash(endpoint: string, body: unknown): Buffer {
  return createHash("sha256").update(endpoint + "\n" + JSON.stringify(stable(body ?? null))).digest();
}

/**
 * Decision D9. Inside the caller's transaction:
 *  - first use of a key: runs fn and stores its response with the key (same commit);
 *  - same key + same user + same body again (double tap / retry after Wi-Fi drop): returns the stored
 *    response without running fn, so nothing is saved twice;
 *  - same key with different data: rejected.
 * If fn fails, the transaction rolls back and the key is not stored, so a retry is allowed.
 */
export async function runIdempotent<T>(
  c: ClientBase,
  o: { key: string | null | undefined; userId: string; endpoint: string; body: unknown },
  fn: () => Promise<T>,
): Promise<{ replayed: boolean; response: T }> {
  if (!o.key || !KEY_RE.test(o.key)) throw Errors.idempotencyMissing();
  const h = requestHash(o.endpoint, o.body);
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [o.key]);
  const r = await c.query("SELECT user_id, endpoint, request_hash, response FROM idempotency_keys WHERE key = $1", [o.key]);
  if (r.rowCount) {
    const row = r.rows[0];
    if (row.user_id !== o.userId || row.endpoint !== o.endpoint || !Buffer.from(row.request_hash).equals(h))
      throw Errors.idempotencyConflict();
    return { replayed: true, response: row.response as T };
  }
  const response = await fn();
  // A refused request is not "used up": the person fixes the value and tries again.
  if (response instanceof Blocked) return { replayed: false, response };
  await c.query(
    "INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, status_code, response) VALUES ($1,$2,$3,$4,200,$5)",
    [o.key, o.userId, o.endpoint, h, JSON.stringify(response ?? null)],
  );
  return { replayed: false, response };
}
