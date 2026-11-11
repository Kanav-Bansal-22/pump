import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createUser } from "@/server/auth/service";
import { createStandardLayout } from "@/server/config/service";
import { runIdempotent } from "@/server/idempotency";
import { createEntry, declareCollections, getDayBalance, setMyUpiTotal, type EntryInput } from "@/server/money/service";
import { connect, tx } from "./helpers/db";

let c: Client;
type U = { id: string; role: string; permissions: string[] };
let owner: U;
let ramesh: U;
let suresh: U;
let today = "";
let k = 0;
const key = () => `staff-test-${Date.now()}-${++k}-xxxxxxxx`;

async function inTx<T>(fn: () => Promise<T>): Promise<T> {
  let out: T;
  const err = await tx(c, async () => {
    out = await fn();
  });
  if (err) throw new Error(err);
  return out!;
}
const entry = (who: U, e: EntryInput) => inTx(() => createEntry(c, who, e, key()));
const upi = (who: U, amount: string) => inTx(() => setMyUpiTotal(c, who, { amount }, key()));

beforeAll(async () => {
  c = await connect("app", "pump_test_staff");
  const mk = async (name: string, username: string, role: "OWNER" | "STAFF") => {
    const id = await inTx(() => createUser(c, { name, username, tempPassword: "a-pass-123", role }));
    const p = (await c.query("SELECT permission_code FROM v_user_permissions WHERE user_id = $1", [id])).rows.map((r) => r.permission_code);
    return { id, role, permissions: p };
  };
  owner = await mk("Owner", "owner_s", "OWNER");
  ramesh = await mk("Ramesh", "ramesh_s", "STAFF");
  suresh = await mk("Suresh", "suresh_s", "STAFF");
  await inTx(() => createStandardLayout(c, "Staff Test Pump"));
  today = (
    await c.query(
      `SELECT CASE WHEN (now() AT TIME ZONE 'Asia/Kolkata')::time >= '08:00' THEN (now() AT TIME ZONE 'Asia/Kolkata')::date
                   ELSE (now() AT TIME ZONE 'Asia/Kolkata')::date - 1 END::text AS d`,
    )
  ).rows[0].d;
});

afterAll(async () => {
  await c?.end();
});

describe("logins", () => {
  it("new employees open the phone view; owners open the register", async () => {
    const r = await c.query("SELECT username, home_view FROM users ORDER BY username");
    expect(Object.fromEntries(r.rows.map((x) => [x.username, x.home_view]))).toEqual({ owner_s: "register", ramesh_s: "simple", suresh_s: "simple" });
  });
});

describe("UPI totals from employees' phones (one QR)", () => {
  it("each person's latest total counts; the sum is used while the QR app total is not typed", async () => {
    await upi(ramesh, "2,000");
    const r = await upi(ramesh, "3500"); // full total so far, replaces 2,000
    expect(r.amount).toBe("3500.00");
    expect(r.history.map((h) => h.amount)).toEqual(["3500.00", "2000.00"]);
    await upi(suresh, "1200.50");
    const b = await inTx(() => getDayBalance(c, today));
    expect(b.staffUpi.map((s) => [s.name, s.amount])).toEqual([
      ["Ramesh", "3500.00"],
      ["Suresh", "1200.50"],
    ]);
    expect(b.collections.find((x) => x.mode === "UPI")).toMatchObject({ total: "4700.50", source: "staff" });
    expect(b.upiCheck).toEqual({ staff: "4700.50", paytm: null, difference: null });
  });

  it("the QR app total typed at End day wins, and the difference is shown", async () => {
    await inTx(() => declareCollections(c, owner, { date: today, amounts: { UPI: "5000" } }, key()));
    const b = await inTx(() => getDayBalance(c, today));
    expect(b.collections.find((x) => x.mode === "UPI")).toMatchObject({ total: "5000.00", source: "machine" });
    expect(b.upiCheck).toEqual({ staff: "4700.50", paytm: "5000.00", difference: "299.50" });
  });

  it("refuses nonsense, other days, and a lost-response retry saves once", async () => {
    await expect(upi(ramesh, "abc")).rejects.toThrow(/number/);
    await expect(inTx(() => setMyUpiTotal(c, ramesh, { amount: "10", businessDate: "2020-01-01" }, key()))).rejects.toThrow(/only be given for today/);
    const kk = key();
    const body = { amount: "4000" };
    const run = () => inTx(() => runIdempotent(c, { key: kk, userId: ramesh.id, endpoint: "my-upi", body }, () => setMyUpiTotal(c, ramesh, body, kk)));
    await run();
    expect((await run()).replayed).toBe(true);
    expect((await c.query("SELECT count(*)::int n FROM staff_upi_totals WHERE amount = 4000")).rows[0].n).toBe(1);
  });

  it("past totals cannot be changed or deleted by the app", async () => {
    await expect(c.query("UPDATE staff_upi_totals SET amount = 1")).rejects.toThrow();
    await expect(c.query("DELETE FROM staff_upi_totals")).rejects.toThrow();
  });
});

describe("double entry protection", () => {
  it("the same udhari for the same customer within minutes asks 'Save anyway'", async () => {
    const first = await entry(ramesh, { kind: "CREDIT_SALE", party: { name: "Bittu" }, amount: "1500", vehicleNo: "PB10" });
    const party = (await c.query("SELECT party_id FROM money_entries WHERE id = $1", [first.entryId])).rows[0].party_id;
    // another phone, same customer and amount: probably the same fill typed twice
    await expect(entry(suresh, { kind: "CREDIT_SALE", party: { id: party }, amount: "1,500" })).rejects.toThrow(/looks like a repeat[^]*Ramesh/);
    // a different amount is fine
    await entry(suresh, { kind: "CREDIT_SALE", party: { id: party }, amount: "1600" });
    // really a second fill: confirmed
    await entry(suresh, { kind: "CREDIT_SALE", party: { id: party }, amount: "1500", confirmRepeat: true });
    expect((await c.query("SELECT count(*)::int n FROM money_entries WHERE party_id = $1 AND amount = 1500", [party])).rows[0].n).toBe(2);
  });

  it("applies to expenses and lube too, but not to different kinds", async () => {
    await entry(ramesh, { kind: "LUBE_SALE", amount: "350", mode: "CASH" });
    await expect(entry(ramesh, { kind: "LUBE_SALE", amount: "350", mode: "UPI" })).rejects.toThrow(/repeat/);
    await entry(ramesh, { kind: "OTHER_INCOME", amount: "350", mode: "CASH" });
  });
});
