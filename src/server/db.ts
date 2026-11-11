import { Pool, types, type PoolClient } from "pg";
import { loadEnv } from "../../scripts/lib/env";

// Keep DATE as 'YYYY-MM-DD' text: never let JS Date shift a business date by timezone.
types.setTypeParser(1082, (v) => v);
// NUMERIC (1700) and BIGINT (20) already arrive as exact strings; we never convert them to float.

const g = globalThis as unknown as { __pumpPool?: Pool };

export function pool(): Pool {
  if (!g.__pumpPool) {
    const env = loadEnv();
    g.__pumpPool = new Pool({
      host: env.DB_HOST,
      port: Number(env.DB_PORT),
      database: env.DB_NAME,
      user: "pump_app",
      password: env.DB_APP_PASSWORD,
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return g.__pumpPool;
}

export function activeDatabase(): string {
  return loadEnv().DB_NAME;
}

export type TxContext = { userId: string | null; requestId: string; ip?: string | null };

/** Runs fn in one transaction with the audit context set. Everything commits together or not at all. */
export async function withTx<T>(ctx: TxContext, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.request_id', $2, true), set_config('app.ip', $3, true)",
      [ctx.userId ?? "", ctx.requestId, ctx.ip ?? ""],
    );
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Simple read query outside a transaction. */
export async function q<R extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<R[]> {
  const r = await pool().query(sql, params);
  return r.rows as R[];
}
