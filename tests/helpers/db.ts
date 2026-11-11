import { Client } from "pg";
import { inject } from "vitest";

type Who = "app" | "owner" | "backup" | "super";

/** Connects as one of the real database roles. "owner" = pump_migrator with SET ROLE pump_owner. */
export async function connect(
  who: Who,
  database?: "pump_test" | "pump_test_clean" | "pump_test_meters" | "pump_test_backup" | "pump_test_money" | "pump_test_import" | "pump_test_reports" | "pump_restored",
): Promise<Client> {
  const db = { ...inject("db"), ...(database ? { database } : {}) };
  const cfg = {
    app: { user: "pump_app", password: db.pump_app },
    owner: { user: "pump_migrator", password: db.pump_migrator },
    backup: { user: "pump_backup", password: db.pump_backup },
    super: { user: "postgres", password: db.superPassword },
  }[who];
  const c = new Client({ host: db.host, port: db.port, database: db.database, ...cfg });
  await c.connect();
  if (who === "owner") await c.query("SET ROLE pump_owner");
  return c;
}

/** Sets the per-transaction request context the app will set (user id, request id). */
export async function setContext(c: Client, userId: string, requestId = "test") {
  await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.request_id', $2, true)", [userId, requestId]);
}

/** Runs fn inside BEGIN/COMMIT; returns the error message if anything (including COMMIT) fails. */
export async function tx(c: Client, fn: () => Promise<void>): Promise<string | null> {
  await c.query("BEGIN");
  try {
    await fn();
    await c.query("COMMIT");
    return null;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    return e instanceof Error ? e.message : String(e);
  }
}

export type Fixture = { siteId: string; ownerId: string; staffId: string; customerId: string; supplierId: string };

let fixture: Fixture | undefined;

/** Creates one site + an owner + a staff user (configuration rows, test database only). */
export async function getFixture(): Promise<Fixture> {
  if (fixture) return fixture;
  const c = await connect("app");
  try {
    const site = await c.query("INSERT INTO sites (name) VALUES ('Test Site') RETURNING id");
    const owner = await c.query(
      "INSERT INTO users (name, username, password_hash, role_code) VALUES ('Owner T','owner_t','x','OWNER') RETURNING id");
    const staff = await c.query(
      "INSERT INTO users (name, username, password_hash, role_code) VALUES ('Staff T','staff_t','x','STAFF') RETURNING id");
    const cust = await c.query("INSERT INTO parties (kind, name, created_by) VALUES ('CUSTOMER','ABC Transport',$1) RETURNING id", [owner.rows[0].id]);
    const supp = await c.query("INSERT INTO parties (kind, name, created_by) VALUES ('SUPPLIER','HPCL',$1) RETURNING id", [owner.rows[0].id]);
    fixture = {
      siteId: site.rows[0].id,
      ownerId: owner.rows[0].id,
      staffId: staff.rows[0].id,
      customerId: cust.rows[0].id,
      supplierId: supp.rows[0].id,
    };
    return fixture;
  } finally {
    await c.end();
  }
}

export async function accountId(c: Client, code: string): Promise<string> {
  const r = await c.query("SELECT id FROM accounts WHERE code = $1", [code]);
  if (!r.rowCount) throw new Error(`no account ${code}`);
  return r.rows[0].id;
}

type Line = { acct: string; dr?: string; cr?: string; party?: [string, string] };

/** Inserts a journal entry with lines (inside the caller's transaction). Returns entry id. */
export async function post(
  c: Client,
  f: Fixture,
  sourceType: string,
  date: string,
  lines: Line[],
  extra: { reverses?: string; approvedBy?: string } = {},
): Promise<string> {
  const e = await c.query(
    `INSERT INTO journal_entries (site_id, business_date, source_type, narration, created_by, reverses_entry_id, approved_by)
     VALUES ($1,$2,$3,'test',$4,$5,$6) RETURNING id`,
    [f.siteId, date, sourceType, f.staffId, extra.reverses ?? null, extra.approvedBy ?? null],
  );
  const entryId = e.rows[0].id;
  let n = 1;
  for (const l of lines) {
    await c.query(
      `INSERT INTO journal_lines (entry_id, line_no, account_id, debit, credit, party_kind, party_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [entryId, n++, await accountId(c, l.acct), l.dr ?? "0", l.cr ?? "0", l.party?.[0] ?? null, l.party?.[1] ?? null],
    );
  }
  return entryId;
}

export async function balance(c: Client, code: string): Promise<string> {
  const r = await c.query("SELECT balance::text FROM v_trial_balance WHERE code = $1", [code]);
  return r.rows[0].balance;
}
