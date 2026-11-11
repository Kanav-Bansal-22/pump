import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createUser } from "@/server/auth/service";
import { createStandardLayout } from "@/server/config/service";
import { addOpeningBalance } from "@/server/money/opening";
import { createEntry, declareCollections, endDay, type EntryInput } from "@/server/money/service";
import { customerLedger, drcr, periodFrom, periodStatement } from "@/server/reports/service";
import { connect, tx } from "./helpers/db";

let c: Client;
let owner: { id: string; role: string; permissions: string[] };
let today = "";
let siteId = "";
let ram = "";
let k = 0;
const key = () => `reports-test-${Date.now()}-${++k}-xxxxxxxx`;
const back = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

async function inTx<T>(fn: () => Promise<T>): Promise<T> {
  let out: T;
  const err = await tx(c, async () => {
    out = await fn();
  });
  if (err) throw new Error(err);
  return out!;
}
const entry = (e: EntryInput) => inTx(() => createEntry(c, owner, e, key()));

beforeAll(async () => {
  c = await connect("app", "pump_test_reports");
  const id = await inTx(() => createUser(c, { name: "Owner R", username: "owner_r", tempPassword: "owner-pass-1", role: "OWNER" }));
  owner = { id, role: "OWNER", permissions: (await c.query("SELECT permission_code FROM v_user_permissions WHERE user_id = $1", [id])).rows.map((r) => r.permission_code) };
  await inTx(() => createStandardLayout(c, "Reports Test Pump"));
  siteId = (await c.query("SELECT id FROM sites LIMIT 1")).rows[0].id;
  today = (
    await c.query(
      "SELECT CASE WHEN (now() AT TIME ZONE 'Asia/Kolkata')::time >= '08:00' THEN (now() AT TIME ZONE 'Asia/Kolkata')::date ELSE (now() AT TIME ZONE 'Asia/Kolkata')::date - 1 END::text d",
    )
  ).rows[0].d;
  await c.query("UPDATE settings SET value = 'false' WHERE key = 'end_day_from_next_morning'");
  const nz = Object.fromEntries((await c.query("SELECT s.code || ':' || n.label k, n.id FROM nozzles n JOIN stations s ON s.id = n.station_id")).rows.map((r) => [r.k, r.id]));
  let i = 0;
  for (const [label, open, close] of [
    ["S1:HSD A1", "1000.00", "1100.00"], // 100 L diesel
    ["S3:MS A1", "500.00", "550.00"], //     50 L petrol
  ]) {
    await c.query("INSERT INTO meter_epochs (nozzle_id, epoch, int_digits, decimals, created_by) VALUES ($1,1,7,2,$2)", [nz[label], id]);
    await c.query(
      `INSERT INTO meter_points (nozzle_id, epoch, reading, cumulative, point_type, business_date, taken_at, effective_at, entered_by, idempotency_key)
       VALUES ($1,1,$2,0,'BASELINE',$3, now() - interval '1 day', now() - interval '1 day', $4, $5)`,
      [nz[label], open, back(today, 2), id, `rep-b-${++i}-xxxxxxxxxxxx`],
    );
    await c.query(
      `INSERT INTO meter_points (nozzle_id, epoch, reading, cumulative, point_type, business_date, entered_by, idempotency_key)
       VALUES ($1,1,$2,0,'DAY_END',$3,$4,$5)`,
      [nz[label], close, today, id, `rep-d-${i}-xxxxxxxxxxxx`],
    );
  }
  for (const [fuel, rate] of [["DIESEL", "95.11"], ["PETROL", "105.17"]])
    await c.query("INSERT INTO daily_rates (site_id, fuel_type_id, business_date, rate, set_by) SELECT $1, id, $3, $4, $5 FROM fuel_types WHERE code = $2", [siteId, fuel, today, rate, id]);

  // Ram: old balance 1,000 (five days ago), fuel on credit 2,000 today, pays 500 cash today
  ram = (await c.query("INSERT INTO parties (kind, name, phone, created_by) VALUES ('CUSTOMER','Ram Transport','9811100000',$1) RETURNING id", [id])).rows[0].id;
  await inTx(() => addOpeningBalance(c, owner, { siteId, partyId: ram, amount: "1000", date: back(today, 5) }));
  await entry({ kind: "CREDIT_SALE", party: { id: ram }, amount: "2000", vehicleNo: "PB10XX0001", slipNo: "101" });
  await entry({ kind: "CUSTOMER_REPAYMENT", party: { id: ram }, amount: "500", mode: "CASH" });
  await entry({ kind: "EXPENSE", expenseCode: "6400", amount: "100", mode: "CASH", description: "milk" });
  await entry({ kind: "EXPENSE", expenseCode: "6500", amount: "50", mode: "UPI" });
  await entry({ kind: "LUBE_SALE", amount: "200", mode: "CASH" });
  await inTx(() => declareCollections(c, owner, { date: today, amounts: { UPI: "3000", CARD: "1000" } }, key()));
  // 14,769.50 sales - 2,000 udhari - 4,000 UPI/card = 8,769.50 cash sales; + 500 + 200 - 100 = 9,369.50 expected
  await inTx(() => endDay(c, owner, { date: today, counted: "9369.50", overrideReason: "only two nozzles in this test" }, key()));
});
afterAll(async () => {
  await c.end();
});

describe("statement periods", () => {
  it("daily / monthly / custom", () => {
    expect(periodFrom({ type: "daily", date: "2026-11-12" }, "2026-11-12")).toMatchObject({ from: "2026-11-12", to: "2026-11-12" });
    expect(periodFrom({ type: "monthly", month: "2026-02" }, "2026-11-12")).toMatchObject({ from: "2026-02-01", to: "2026-02-28", label: "February 2026" });
    expect(periodFrom({ type: "monthly", month: "2028-02" }, "2026-11-12")).toMatchObject({ to: "2028-02-29" }); // leap year
    expect(periodFrom({ type: "custom", from: "2026-11-20", to: "2026-11-01" }, "2026-11-12")).toMatchObject({ from: "2026-11-01", to: "2026-11-20" });
  });
  it("Dr / Cr formatting", () => {
    expect(drcr("250000")).toBe("2,50,000.00 Dr");
    expect(drcr("-1000")).toBe("1,000.00 Cr");
    expect(drcr("0")).toBe("0.00");
  });
});

describe("period statement (accountant view)", () => {
  it("sales, how they were received, expenses, cash book and debtors all agree", async () => {
    const s = await inTx(() => periodStatement(c, { from: today, to: today }));
    const t = s.totals;
    expect([t.dieselL, t.petrolL, t.diesel, t.petrol, t.fuelSales]).toEqual(["100.000", "50.000", "9511.00", "5258.50", "14769.50"]);
    // received by: cash + UPI + card + bank + credit = fuel sales
    expect([t.cashSales, t.upi, t.card, t.bankOther, t.udhariGiven]).toEqual(["8769.50", "3000.00", "1000.00", "0.00", "2000.00"]);
    expect(t.udhariReceived).toBe("500.00");
    expect(s.incomeHeads).toEqual([{ head: "Lubricant / other product sale", cash: "200.00", other: "0.00", total: "200.00" }]);
    expect(s.expenseHeads).toEqual([
      { head: "Miscellaneous expenses", cash: "0.00", other: "50.00", total: "50.00" },
      { head: "Tea, milk & refreshments", cash: "100.00", other: "0.00", total: "100.00" },
    ]);
    // cash book closes at exactly the counted cash
    expect(s.cash.opening).toBe("0.00");
    expect(s.cash.closing).toBe("9369.50");
    expect([t.expectedCash, t.counted, t.difference]).toEqual(["9369.50", "9369.50", "0.00"]);
    // debtors: b/f 1,000 + given 2,000 - received 500 = 2,500
    expect(s.debtors.rows.map((r) => [r.name, r.opening, r.debit, r.credit, r.closing])).toEqual([["Ram Transport", "1000.00", "2000.00", "500.00", "2500.00"]]);
    expect(s.notEnded).toEqual([]);
  });

  it("a longer period includes the old balance as a debit and starts from zero", async () => {
    const s = await inTx(() => periodStatement(c, { from: back(today, 10), to: today }));
    expect(s.debtors.rows[0]).toMatchObject({ opening: "0.00", debit: "3000.00", credit: "500.00", closing: "2500.00" });
  });
});

describe("customer ledger", () => {
  it("brings the balance forward and closes in Dr / Cr", async () => {
    const l = await inTx(() => customerLedger(c, ram, { from: today, to: today }));
    expect(l.broughtForward).toBe("1000.00");
    expect(l.lines.map((x) => [x.particulars, x.debit, x.credit, x.balance])).toEqual([
      ["Fuel on credit", "2000.00", "0.00", "3000.00"],
      ["Payment received", "0.00", "500.00", "2500.00"],
    ]);
    expect(l.lines[0].detail).toBe("PB10XX0001 · slip 101");
    expect(l.closing).toBe("2500.00");
    const full = await inTx(() => customerLedger(c, ram, { from: back(today, 10), to: today }));
    expect(full.broughtForward).toBe("0.00");
    expect(full.lines[0]).toMatchObject({ particulars: "Opening balance (old register)", debit: "1000.00" });
  });
});
