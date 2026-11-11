import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  changePassword,
  createFirstOwner,
  createUser,
  getSessionUser,
  isFirstRun,
  loginWithPassword,
  resetPassword,
  revokeAllSessions,
  setUserActive,
} from "@/server/auth/service";
import { createStandardLayout, getLayout } from "@/server/config/service";
import { runIdempotent } from "@/server/idempotency";
import { formatINR, parseAmount } from "@/server/money";
import { connect, tx } from "./helpers/db";

let c: Client;
beforeAll(async () => {
  c = await connect("app");
});
afterAll(async () => {
  await c.end();
});

/** Runs fn in a transaction and returns its value (throws on failure). */
async function inTx<T>(fn: () => Promise<T>): Promise<T> {
  let out: T;
  const err = await tx(c, async () => {
    out = await fn();
  });
  if (err) throw new Error(err);
  return out!;
}

const login = (username: string, password: string) =>
  inTx(() => loginWithPassword(c, { username, password, ip: "10.0.0.5", userAgent: "test", sessionHours: 12 }));

describe("money helpers (no floats)", () => {
  it("parses typed amounts exactly, including Indian commas", () => {
    expect(parseAmount("1,80,000")).toBe("180000.00");
    expect(parseAmount("550.5")).toBe("550.50");
    for (const bad of ["0", "-5", "12.345", "abc", "", "1e5"]) expect(() => parseAmount(bad)).toThrow();
  });
  it("formats with Indian grouping", () => {
    expect(formatINR("1380181")).toBe("₹13,80,181.00");
    expect(formatINR("931")).toBe("₹931.00");
    expect(formatINR("-859314.5")).toBe("-₹8,59,314.50");
  });
});

describe("accounts and login", () => {
  let ownerId = "";

  it("sets up the shared owner used by the following tests", async () => {
    ownerId = await inTx(() => createUser(c, { name: "Owner A", username: "owner_a", tempPassword: "owner-pass-1", role: "OWNER" }));
    await c.query("UPDATE users SET must_change_password = false WHERE id = $1", [ownerId]);
    expect(ownerId).toMatch(/[0-9a-f-]{36}/);
  });

  it("logs in with the right password and returns a working session", async () => {
    const r = await login("OWNER_A", "owner-pass-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = await getSessionUser(c, r.token);
    expect(u?.role).toBe("OWNER");
    expect(u?.permissions).toContain("closing.lock");
  });

  it("rejects wrong passwords and unknown users with the same message, and logs every attempt", async () => {
    const a = await login("owner_a", "nope-nope");
    const b = await login("ghost_user", "nope-nope");
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok && !b.ok) expect(a.error.message).toBe(b.error.message);
    const n = await c.query("SELECT count(*)::int n FROM login_attempts WHERE username IN ('owner_a','ghost_user') AND NOT success");
    expect(n.rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it("locks the account after 5 wrong passwords, even with the right password", async () => {
    await inTx(() => createUser(c, { name: "Lock Test", username: "lock_t", tempPassword: "right-pass-1", role: "STAFF" }));
    for (let i = 0; i < 5; i++) expect((await login("lock_t", "wrong-pass")).ok).toBe(false);
    const r = await login("lock_t", "right-pass-1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("LOCKED");
  });

  it("staff get only the staff permissions", async () => {
    await inTx(() => createUser(c, { name: "Ramesh", username: "ramesh", tempPassword: "temp-pass-1", role: "STAFF" }));
    const r = await login("ramesh", "temp-pass-1");
    expect(r.ok && r.mustChangePassword).toBe(true);
    if (!r.ok) return;
    const u = (await getSessionUser(c, r.token))!;
    expect(u.permissions).toEqual(
      [
        "cash.count",
        "closing.lock", // may end a CLEAN day (migration 0010)
        "credit.create",
        "customer.view_balance",
        "meter.enter",
        "meter.event.request",
        "payment.create",
        "price.set",
        "receipt.create",
        "tests.record",
      ].sort(),
    );
    for (const p of ["closing.override", "users.manage", "report.financial", "meter.event.approve", "settings.manage", "import.run", "backup.manage"])
      expect(u.permissions).not.toContain(p);
  });

  it("changing password requires the old one and signs out other phones", async () => {
    const s1 = await login("ramesh", "temp-pass-1");
    const s2 = await login("ramesh", "temp-pass-1");
    if (!s1.ok || !s2.ok) throw new Error("login failed");
    const u = (await getSessionUser(c, s1.token))!;
    await expect(inTx(() => changePassword(c, u, "wrong-old", "new-pass-123"))).rejects.toThrow(/Current password is wrong/);
    await inTx(() => changePassword(c, u, "temp-pass-1", "new-pass-123"));
    expect(await getSessionUser(c, s1.token)).not.toBeNull(); // this phone stays logged in
    expect(await getSessionUser(c, s2.token)).toBeNull(); // the other phone is signed out
    expect((await login("ramesh", "new-pass-123")).ok).toBe(true);
  });

  it("owner reset forces a new password and signs the person out everywhere", async () => {
    const s = await login("ramesh", "new-pass-123");
    if (!s.ok) throw new Error("login failed");
    const id = (await getSessionUser(c, s.token))!.id;
    await inTx(() => resetPassword(c, id, "reset-pass-1"));
    expect(await getSessionUser(c, s.token)).toBeNull();
    const again = await login("ramesh", "reset-pass-1");
    expect(again.ok && again.mustChangePassword).toBe(true);
  });

  it("a disabled login cannot sign in and its sessions end; the last owner cannot be disabled", async () => {
    const s = await login("ramesh", "reset-pass-1");
    if (!s.ok) throw new Error("login failed");
    const id = (await getSessionUser(c, s.token))!.id;
    await inTx(() => setUserActive(c, ownerId, id, false));
    expect(await getSessionUser(c, s.token)).toBeNull();
    expect((await login("ramesh", "reset-pass-1")).ok).toBe(false);
    await expect(inTx(() => setUserActive(c, ownerId, ownerId, false))).rejects.toThrow(/your own account/);
  });

  it("'sign out all phones' revokes every session (lost phone)", async () => {
    await login("owner_a", "owner-pass-1");
    const s = await login("owner_a", "owner-pass-1");
    if (!s.ok) throw new Error("login failed");
    const n = await inTx(() => revokeAllSessions(c, ownerId));
    expect(n).toBeGreaterThanOrEqual(2);
    expect(await getSessionUser(c, s.token)).toBeNull();
  });

  it("password hashes never appear in the audit log", async () => {
    const r = await c.query(
      "SELECT count(*)::int n FROM audit_log WHERE table_name = 'users' AND (new_value->>'password_hash' LIKE '$argon2%' OR old_value->>'password_hash' LIKE '$argon2%')",
    );
    expect(r.rows[0].n).toBe(0);
    const red = await c.query("SELECT count(*)::int n FROM audit_log WHERE table_name = 'users' AND new_value->>'password_hash' = '[redacted]'");
    expect(red.rows[0].n).toBeGreaterThan(0);
  });
});

describe("idempotency (double tap / retry after Wi-Fi drop)", () => {
  let userId = "";
  beforeAll(async () => {
    userId = (await c.query("SELECT id FROM users WHERE username = 'owner_a'")).rows[0].id;
  });

  it("runs once; the retry gets the same answer and nothing is saved twice", async () => {
    let runs = 0;
    const key = "k".repeat(20) + Date.now();
    const call = () =>
      inTx(() =>
        runIdempotent(c, { key, userId, endpoint: "test.save", body: { amount: "550.00", note: "milk" } }, async () => {
          runs++;
          return { saved: runs };
        }),
      );
    const a = await call();
    const b = await call();
    expect(a).toEqual({ replayed: false, response: { saved: 1 } });
    expect(b).toEqual({ replayed: true, response: { saved: 1 } });
    expect(runs).toBe(1);
  });

  it("the same key with different data is refused", async () => {
    const key = "z".repeat(20) + Date.now();
    await inTx(() => runIdempotent(c, { key, userId, endpoint: "test.save", body: { amount: "1.00" } }, async () => ({})));
    await expect(
      inTx(() => runIdempotent(c, { key, userId, endpoint: "test.save", body: { amount: "2.00" } }, async () => ({}))),
    ).rejects.toThrow(/already used for different data/);
  });

  it("if saving fails, the key is not used up and a retry can succeed", async () => {
    const key = "f".repeat(20) + Date.now();
    await expect(
      inTx(() =>
        runIdempotent(c, { key, userId, endpoint: "test.save", body: {} }, async () => {
          throw new Error("disk full");
        }),
      ),
    ).rejects.toThrow(/disk full/);
    const ok = await inTx(() => runIdempotent(c, { key, userId, endpoint: "test.save", body: {} }, async () => ({ ok: 1 })));
    expect(ok.replayed).toBe(false);
  });

  it("parallel double tap from two connections saves once", async () => {
    const key = "p".repeat(20) + Date.now();
    const c2 = await connect("app");
    let runs = 0;
    const one = (cl: Client) =>
      (async () => {
        await cl.query("BEGIN");
        const r = await runIdempotent(cl, { key, userId, endpoint: "test.save", body: { a: 1 } }, async () => {
          runs++;
          await new Promise((res) => setTimeout(res, 150));
          return { n: runs };
        });
        await cl.query("COMMIT");
        return r;
      })();
    try {
      const [r1, r2] = await Promise.all([one(c), one(c2)]);
      expect(runs).toBe(1);
      expect([r1.replayed, r2.replayed].sort()).toEqual([false, true]);
    } finally {
      await c2.end();
    }
  });
});

describe("first run and pump layout (pristine database)", () => {
  let clean: Client;
  const inClean = async <T,>(fn: () => Promise<T>): Promise<T> => {
    let out: T;
    const err = await tx(clean, async () => {
      out = await fn();
    });
    if (err) throw new Error(err);
    return out!;
  };
  beforeAll(async () => {
    clean = await connect("app", "pump_test_clean");
  });
  afterAll(async () => {
    await clean.end();
  });

  it("first run creates exactly one owner, then refuses a second", async () => {
    expect(await inClean(() => isFirstRun(clean))).toBe(true);
    await inClean(() => createFirstOwner(clean, { name: "Owner", username: "owner", password: "owner-pass-1" }));
    expect(await inClean(() => isFirstRun(clean))).toBe(false);
    await expect(inClean(() => createFirstOwner(clean, { name: "Intruder", username: "intruder", password: "intruder-1" }))).rejects.toThrow(
      /already exists/,
    );
    const n = await clean.query("SELECT count(*)::int n FROM users");
    expect(n.rows[0].n).toBe(1);
  });

  it("creates exactly the confirmed 3 stations / 6 nozzles, and only once", async () => {
    expect((await inClean(() => getLayout(clean))).site).toBeNull();
    await inClean(() => createStandardLayout(clean, "Test Pump"));
    const layout = await inClean(() => getLayout(clean));
    expect(layout.site?.dayCutover).toBe("08:00");
    expect(layout.stations.flatMap((s) => s.nozzles.map((n) => `${s.code}:${n.label}:${n.fuelCode}`))).toEqual([
      "S1:HSD A1:DIESEL",
      "S1:HSD A2:DIESEL",
      "S2:HSD A1:DIESEL",
      "S2:HSD A2:DIESEL",
      "S3:MS A1:PETROL",
      "S3:MS A2:PETROL",
    ]);
    await expect(inClean(() => createStandardLayout(clean, "Again"))).rejects.toThrow(/already exists/);
  });
});
