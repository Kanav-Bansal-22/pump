import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createUser } from "@/server/auth/service";
import { createStandardLayout, setOwnQr, setTypeEachUpi } from "@/server/config/service";
import { openTests, recordTest, voidTest } from "@/server/meters/service";
import { dayMessage } from "@/components/whatsapp-share";
import { runIdempotent } from "@/server/idempotency";
import { addOpeningBalance } from "@/server/money/opening";
import { addMyUpi, cancelMyUpi, createEntry, customerList, declareCollections, getDayBalance, removeCustomer, reverseEntry, type EntryInput } from "@/server/money/service";
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
const upi = (who: U, amount: string) => inTx(() => addMyUpi(c, who, { amount }, key()));

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
  it("each amount entered adds up; a wrong one is cancelled; the net per person goes to the register", async () => {
    await upi(ramesh, "2,000");
    const wrong = await upi(ramesh, "5000"); // meant 500
    expect(wrong.totals.UPI).toBe("7000.00");
    const fixed = await inTx(() => cancelMyUpi(c, ramesh, wrong.payments[0].id, key()));
    expect(fixed.totals.UPI).toBe("2000.00");
    await upi(ramesh, "500");
    const r = await upi(ramesh, "1000");
    expect(r.totals.UPI).toBe("3500.00");
    expect(r.payments.map((p) => [p.amount, p.cancelled])).toEqual([
      ["1000.00", false],
      ["500.00", false],
      ["5000.00", true],
      ["2000.00", false],
    ]);
    await expect(inTx(() => cancelMyUpi(c, ramesh, wrong.payments[0].id, key()))).rejects.toThrow(/already cancelled/);
    await expect(inTx(() => cancelMyUpi(c, suresh, r.payments[0].id, key()))).rejects.toThrow(/not allowed/);
    await upi(suresh, "1200.50");
    const b = await inTx(() => getDayBalance(c, today));
    expect(b.staffUpi.map((s) => [s.mode, s.name, s.amount, s.payments])).toEqual([
      ["UPI", "Ramesh", "3500.00", 3],
      ["UPI", "Suresh", "1200.50", 1],
    ]);
    expect(b.collections.find((x) => x.mode === "UPI")).toMatchObject({ total: "4700.50", source: "staff" });
    expect(b.staffChecks).toEqual([{ mode: "UPI", label: "UPI", staff: "4700.50", machine: null, difference: null }]);
    // no nozzle closing yet: sales unknown, so no "UPI is more than sales" alarm (owner saw −300 cash)
    expect(b.sales.complete).toBe(false);
    expect(b.problems.some((p) => p.includes("more than the fuel sales"))).toBe(false);
  });

  it("the QR app total typed at End day wins, and the difference is shown", async () => {
    await inTx(() => declareCollections(c, owner, { date: today, amounts: { UPI: "5000" } }, key()));
    const b = await inTx(() => getDayBalance(c, today));
    expect(b.collections.find((x) => x.mode === "UPI")).toMatchObject({ total: "5000.00", source: "machine" });
    expect(b.staffChecks).toEqual([{ mode: "UPI", label: "UPI", staff: "4700.50", machine: "5000.00", difference: "299.50" }]);
  });

  it("card payments are kept apart from UPI: own total, own check against the card machine", async () => {
    const r = await inTx(() => addMyUpi(c, suresh, { amount: "2500", mode: "CARD" }, key()));
    expect(r.totals).toEqual({ UPI: "1200.50", CARD: "2500.00" });
    await inTx(() => addMyUpi(c, ramesh, { amount: "1000", mode: "CARD" }, key()));
    let b = await inTx(() => getDayBalance(c, today));
    expect(b.collections.find((x) => x.mode === "CARD")).toMatchObject({ total: "3500.00", source: "staff" });
    expect(b.collections.find((x) => x.mode === "UPI")).toMatchObject({ total: "5000.00", source: "machine" }); // unchanged
    expect(b.staffChecks.find((x) => x.mode === "CARD")).toEqual({ mode: "CARD", label: "Card", staff: "3500.00", machine: null, difference: null });
    await inTx(() => declareCollections(c, owner, { date: today, amounts: { CARD: "3500" } }, key()));
    b = await inTx(() => getDayBalance(c, today));
    expect(b.staffChecks.find((x) => x.mode === "CARD")).toMatchObject({ machine: "3500.00", difference: "0.00" });
  });

  it("refuses nonsense, other days, and a lost-response retry saves once", async () => {
    await expect(upi(ramesh, "abc")).rejects.toThrow(/number/);
    await expect(upi(ramesh, "0")).rejects.toThrow(/number|Amount/);
    await expect(inTx(() => addMyUpi(c, ramesh, { amount: "10", businessDate: "2020-01-01" }, key()))).rejects.toThrow(/only be entered for today/);
    const kk = key();
    const body = { amount: "4000" };
    const run = () => inTx(() => runIdempotent(c, { key: kk, userId: ramesh.id, endpoint: "my-upi", body }, () => addMyUpi(c, ramesh, body, kk)));
    await run();
    expect((await run()).replayed).toBe(true);
    expect((await c.query("SELECT count(*)::int n FROM staff_upi_payments WHERE amount = 4000")).rows[0].n).toBe(1);
  });

  it("past totals cannot be changed or deleted by the app", async () => {
    await expect(c.query("UPDATE staff_upi_payments SET amount = 1")).rejects.toThrow();
    await expect(c.query("DELETE FROM staff_upi_payments")).rejects.toThrow();
    await expect(c.query("DELETE FROM staff_upi_payment_cancels")).rejects.toThrow();
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

describe("testing fuel", () => {
  it("records a test (not a sale), refuses bad input, and only the person or the owner can cancel it", async () => {
    const nozzle = (await c.query("SELECT id FROM nozzles WHERE label = 'MS A1'")).rows[0].id;
    const t = await inTx(() => recordTest(c, ramesh, { nozzleId: nozzle, litres: "5", returned: true }, key()));
    expect(t).toMatchObject({ label: "MS A1", litres: "5.000" });
    await expect(inTx(() => recordTest(c, ramesh, { nozzleId: nozzle, litres: "60", returned: true }, key()))).rejects.toThrow(/between 0 and 50/);
    await expect(inTx(() => recordTest(c, ramesh, { nozzleId: nozzle, litres: "2", returned: false }, key()))).rejects.toThrow(/write why/);
    await inTx(() => recordTest(c, ramesh, { nozzleId: nozzle, litres: "2", returned: false, reason: "kept as sample" }, key()));
    let open = await inTx(() => openTests(c));
    expect(open.map((x) => [x.litres, x.returned, x.voided])).toEqual([
      ["2.000", false, false],
      ["5.000", true, false],
    ]);
    await expect(inTx(() => voidTest(c, suresh, { testId: t.testId, reason: "not mine" }))).rejects.toThrow(/not allowed/);
    await expect(inTx(() => voidTest(c, ramesh, { testId: t.testId, reason: "no" }))).rejects.toThrow(/at least 5/);
    await inTx(() => voidTest(c, owner, { testId: t.testId, reason: "typed twice" }));
    open = await inTx(() => openTests(c));
    expect(open.find((x) => x.id === t.testId)?.voided).toBe(true);
    await expect(inTx(() => voidTest(c, owner, { testId: t.testId, reason: "typed twice" }))).rejects.toThrow(/already cancelled/);
  });
});

describe("WhatsApp day message", () => {
  it("reads like the register: sales, modes, udhari, cash and what does not match", () => {
    const msg = dayMessage("Demo Pump", {
      date: "2026-11-11",
      sales: { byFuel: { DIESEL: { litres: "100.000", value: "9511.00" } }, total: "9511.00", complete: true },
      udhariGiven: "1000.00",
      udhariReceived: "500.00",
      otherIn: "0.00",
      paymentsAll: "200.00",
      collections: [{ label: "UPI", total: "2000.00" }, { label: "Card", total: null }],
      expectedCash: "6811.00",
      counted: "6800.00",
      difference: "-11.00",
      staffChecks: [{ label: "UPI", staff: "1900.00", machine: "2000.00", difference: "100.00" }],
    });
    expect(msg).toContain("*Fuel sales: ₹9,511.00*");
    expect(msg).toContain("UPI: ₹2,000.00");
    expect(msg).not.toContain("Card:");
    expect(msg).toContain("Cash SHORT ₹11.00");
    expect(msg).toContain("UPI: machine ₹2,000.00, staff entered ₹1,900.00");
  });
});

describe("each worker's own Paytm QR", () => {
  it("each QR's Paytm total is checked against what that worker typed; their sum is the day's UPI", async () => {
    await inTx(() => setOwnQr(c, ramesh.id, true));
    await inTx(() => setOwnQr(c, suresh.id, true));
    const before = await inTx(() => getDayBalance(c, today));
    const typed = (u: U) => before.qr.checks.find((x) => x.userId === u.id)!.typed!;
    const R = typed(ramesh);
    const S = typed(suresh);
    expect(before.qr.workers.map((w) => w.name)).toEqual(["Ramesh", "Suresh"]);

    const plus = (a: string, b: string) => (Math.round(Number(a) * 100 + Number(b) * 100) / 100).toFixed(2);
    // a UPI total typed directly is ignored once workers have their own QRs
    await inTx(() => declareCollections(c, owner, { date: today, amounts: { UPI: "99999" }, qr: { [ramesh.id]: plus(R, "500"), [suresh.id]: S, SHOP: "1000" } }, key()));
    let b = await inTx(() => getDayBalance(c, today));
    const row = (id: string | null) => b.qr.checks.find((x) => x.userId === id)!;
    expect(row(ramesh.id)).toMatchObject({ qr: plus(R, "500"), difference: "500.00" });
    expect(row(suresh.id)).toMatchObject({ qr: S, difference: "0.00" });
    expect(row(null)).toMatchObject({ name: "Shop QR", qr: "1000.00", typed: null, difference: null });
    expect(b.collections.find((x) => x.mode === "UPI")!.total).toBe(plus(plus(plus(R, "500"), S), "1000"));
    expect(dayMessage("P", b)).toContain(`Ramesh QR: Paytm`);
    expect(dayMessage("P", b)).not.toContain("Suresh QR");

    // a corrected QR figure replaces the old one, and the UPI total follows
    await inTx(() => declareCollections(c, owner, { date: today, amounts: {}, qr: { [ramesh.id]: R } }, key()));
    b = await inTx(() => getDayBalance(c, today));
    expect(row(ramesh.id).difference).toBe("0.00");
    expect(b.collections.find((x) => x.mode === "UPI")!.total).toBe(plus(plus(R, S), "1000"));

    // only workers with their own QR (or the shop QR)
    await expect(inTx(() => declareCollections(c, owner, { date: today, amounts: {}, qr: { [owner.id]: "50" } }, key()))).rejects.toThrow(/no QR/);
  });

  it("typing each UPI payment can be switched off: phones then take card only", async () => {
    await inTx(() => setTypeEachUpi(c, false));
    await expect(upi(ramesh, "100")).rejects.toThrow(/not typed on the phone/);
    const card = await inTx(() => addMyUpi(c, ramesh, { amount: "700", mode: "CARD" }, key()));
    expect(card.mode).toBe("CARD");
    expect((await inTx(() => getDayBalance(c, today))).qr.typeEach).toBe(false);
    await inTx(() => setTypeEachUpi(c, true));
    expect((await upi(ramesh, "100")).mode).toBe("UPI");
  });
});

describe("udhari catch-up for earlier days, and removing a customer", () => {
  it("owner can enter udhari for days after the old balances; staff and other kinds cannot", async () => {
    const day = async (n: number) => (await c.query("SELECT ($1::date - $2::int)::text d", [today, n])).rows[0].d as string;
    const [d3, d2] = [await day(3), await day(2)];
    const site = (await c.query("SELECT id FROM sites LIMIT 1")).rows[0].id;
    const cust = (await c.query("INSERT INTO parties (kind, name, created_by) VALUES ('CUSTOMER','Catchup Transport',$1) RETURNING id", [owner.id])).rows[0].id;
    await inTx(() => addOpeningBalance(c, owner, { siteId: site, partyId: cust, amount: "5000", date: d3 }));

    const e = await entry(owner, { kind: "CREDIT_SALE", businessDate: d2, party: { id: cust }, amount: "700" });
    expect(e.businessDate).toBe(d2);
    // on / before the old balances' date it is already in them
    await expect(entry(owner, { kind: "CREDIT_SALE", businessDate: d3, party: { id: cust }, amount: "300" })).rejects.toThrow(/old balances are as on/);
    await expect(entry(owner, { kind: "CREDIT_SALE", businessDate: "2099-01-01", party: { id: cust }, amount: "300" })).rejects.toThrow(/to today/);
    await expect(entry(ramesh, { kind: "CREDIT_SALE", businessDate: d2, party: { id: cust }, amount: "300" })).rejects.toThrow(/today's business day/);
    await expect(entry(owner, { kind: "LUBE_SALE", businessDate: d2, amount: "300", mode: "CASH" })).rejects.toThrow(/today's business day/);

    // remove: refused while a later entry leaves a balance; after cancelling it, the old balance is cancelled too
    await expect(inTx(() => removeCustomer(c, owner, { partyId: cust, reason: "added twice" }))).rejects.toThrow(/still has udhari of ₹700/);
    await expect(inTx(() => removeCustomer(c, ramesh, { partyId: cust, reason: "added twice" }))).rejects.toThrow(/not allowed/);
    await inTx(() => reverseEntry(c, owner, { entryId: e.entryId, reason: "typed by mistake" }));
    const r = await inTx(() => removeCustomer(c, owner, { partyId: cust, reason: "added twice" }));
    expect(r.openingCancelled).toBe("5000.00");
    expect((await c.query("SELECT COALESCE(SUM(debit - credit),0)::numeric(14,2)::text b FROM journal_lines WHERE party_id = $1", [cust])).rows[0].b).toBe("0.00");
    expect(((await inTx(() => customerList(c))) as Array<{ id: string }>).some((x) => x.id === cust)).toBe(false);
    await expect(inTx(() => removeCustomer(c, owner, { partyId: cust, reason: "added twice" }))).rejects.toThrow(/already removed/);
  });
});
