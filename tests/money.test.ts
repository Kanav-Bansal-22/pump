import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createUser } from "@/server/auth/service";
import { createStandardLayout } from "@/server/config/service";
import { runIdempotent } from "@/server/idempotency";
import { countCash, createEntry, declareCollections, endDay, findOrCreateParty, getDayBalance, lockDay, partyStatement, reopenDay, reverseEntry, type EntryInput } from "@/server/money/service";
import { connect, tx } from "./helpers/db";

let c: Client;
let owner: { id: string; role: string; permissions: string[] };
let staff: { id: string; role: string; permissions: string[] };
let today = "";
let siteId = "";
const N: Record<string, string> = {};
let k = 0;
const key = () => `money-test-${Date.now()}-${++k}-xxxxxxxx`;

async function inTx<T>(fn: () => Promise<T>): Promise<T> {
  let out: T;
  const err = await tx(c, async () => {
    out = await fn();
  });
  if (err) throw new Error(err);
  return out!;
}
const entry = (who: typeof staff, e: EntryInput) => inTx(() => createEntry(c, who, e, key()));
const bal = (code: string) =>
  c.query(
    `SELECT COALESCE(SUM(l.debit - l.credit),0)::numeric(14,2)::text AS b FROM journal_lines l JOIN accounts a ON a.id = l.account_id
       JOIN journal_entries e ON e.id = l.entry_id WHERE a.code = $1 AND e.business_date = $2`,
    [code, today],
  ).then((r) => r.rows[0].b as string);

// Register page 224 (closing - opening per nozzle)
const DAY = [
  ["S1:HSD A1", "1847703.80", "1849583.37"], // 1,879.57 L
  ["S1:HSD A2", "1657253.93", "1659170.43"], // 1,916.50 L
  ["S2:HSD A1", "8492191.87", "8496290.94"], // 4,099.07 L
  ["S2:HSD A2", "3844961.65", "3846002.33"], // 1,040.68 L
  ["S3:MS A1", "1028219.48", "1028910.49"], //   691.01 L
  ["S3:MS A2", "764261.82", "764439.42"], //     177.60 L
];

async function dayEnd(label: string, reading: string) {
  await c.query(
    `INSERT INTO meter_points (nozzle_id, epoch, reading, cumulative, point_type, business_date, entered_by, idempotency_key)
     VALUES ($1, 1, $2, 0, 'DAY_END', $3, $4, $5)`,
    [N[label], reading, today, staff.id, key()],
  );
}

beforeAll(async () => {
  c = await connect("app", "pump_test_money");
  const ownerId = await inTx(() => createUser(c, { name: "Owner", username: "owner_x", tempPassword: "owner-pass-1", role: "OWNER" }));
  const staffId = await inTx(() => createUser(c, { name: "Ramesh", username: "ramesh_x", tempPassword: "staff-pass-1", role: "STAFF" }));
  await inTx(() => createStandardLayout(c, "Money Test Pump"));
  const perms = async (id: string) => (await c.query("SELECT permission_code FROM v_user_permissions WHERE user_id = $1", [id])).rows.map((r) => r.permission_code);
  owner = { id: ownerId, role: "OWNER", permissions: await perms(ownerId) };
  staff = { id: staffId, role: "STAFF", permissions: await perms(staffId) };
  siteId = (await c.query("SELECT id FROM sites LIMIT 1")).rows[0].id;
  today = (
    await c.query(
      `SELECT CASE WHEN (now() AT TIME ZONE 'Asia/Kolkata')::time >= '08:00' THEN (now() AT TIME ZONE 'Asia/Kolkata')::date
                   ELSE (now() AT TIME ZONE 'Asia/Kolkata')::date - 1 END::text AS d`,
    )
  ).rows[0].d;
  for (const r of (await c.query("SELECT n.id, s.code || ':' || n.label AS k FROM nozzles n JOIN stations s ON s.id = n.station_id")).rows) N[r.k] = r.id;
  for (const [label, open] of DAY) {
    await c.query("INSERT INTO meter_epochs (nozzle_id, epoch, int_digits, decimals, created_by) VALUES ($1,1,7,2,$2)", [N[label], ownerId]);
    await c.query(
      `INSERT INTO meter_points (nozzle_id, epoch, reading, cumulative, point_type, business_date, taken_at, effective_at, entered_by, idempotency_key)
       VALUES ($1,1,$2,0,'BASELINE',($3::date - 3), now() - interval '1 day', now() - interval '1 day', $4, $5)`,
      [N[label], open, today, ownerId, key()],
    );
  }
  for (const [fuel, rate] of [["DIESEL", "95.11"], ["PETROL", "105.17"]])
    await c.query(
      "INSERT INTO daily_rates (site_id, fuel_type_id, business_date, rate, set_by) SELECT $1, id, $3, $4, $5 FROM fuel_types WHERE code = $2",
      [siteId, fuel, today, rate, ownerId],
    );
});
afterAll(async () => {
  await c.end();
});

describe("End day timing", () => {
  it("today cannot be ended before tomorrow morning's closing (setting on by default)", async () => {
    await expect(inTx(() => endDay(c, owner, { date: today, counted: "0" }, key()))).rejects.toThrow(/still running until the next day.s 8 AM closing/);
    // the remaining tests end "today" on purpose (they cannot wait for tomorrow): switch the rule off here
    await c.query("UPDATE settings SET value = 'false' WHERE key = 'end_day_from_next_morning'");
  });
});

const daysBefore = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

describe("go-live", () => {
  it("the day closed by the starting readings (and earlier days) cannot be ended: nothing happened in the app", async () => {
    await expect(inTx(() => endDay(c, owner, { date: daysBefore(today, 3), counted: "0", overrideReason: "trying anyway" }, key()))).rejects.toThrow(
      /before go-live/,
    );
    await expect(inTx(() => endDay(c, owner, { date: "2026-01-15", counted: "0", overrideReason: "trying anyway" }, key()))).rejects.toThrow(/before go-live/);
  });
});

describe("End day with problems (no readings at all)", () => {
  let quiet = "";
  beforeAll(() => {
    quiet = daysBefore(today, 1); // after go-live, but no readings entered for it
  });
  it("staff cannot end it; nothing is saved, not even the cash count", async () => {
    await expect(inTx(() => endDay(c, staff, { date: quiet, counted: "0" }, key()))).rejects.toThrow(/Cannot end the day yet: Readings missing.*ask the owner/);
    expect((await c.query("SELECT count(*)::int n FROM cash_counts WHERE business_date = $1", [quiet])).rows[0].n).toBe(0);
    expect((await c.query("SELECT status FROM business_days WHERE business_date = $1", [quiet])).rows[0]?.status ?? "OPEN").toBe("OPEN");
  });
  it("owner must write a reason, then the day ends with zero figures", async () => {
    await expect(inTx(() => endDay(c, owner, { date: quiet, counted: "0" }, key()))).rejects.toThrow(/end anyway with a written reason/);
    const r = await inTx(() => endDay(c, owner, { date: quiet, counted: "0", overrideReason: "pump closed for repairs" }, key()));
    expect(r.integrityCode).toMatch(/^[0-9A-F]{8}$/);
    await expect(inTx(() => endDay(c, owner, { date: quiet, counted: "0" }, key()))).rejects.toThrow(/already ended/);
  });
});

describe("a register day: entries -> balance -> count -> lock", () => {
  let bittu = "";
  let milkEntry = "";

  it("records udhari given, received, payments like the Rokad", async () => {
    const b1 = await entry(staff, { kind: "CREDIT_SALE", party: { name: "Bittu Khan", phone: "9876543210" }, amount: "3050", vehicleNo: "pb 10 ab 3241", slipNo: "27598" });
    bittu = (await c.query("SELECT party_id FROM money_entries WHERE id = $1", [b1.entryId])).rows[0].party_id;
    await entry(staff, { kind: "CREDIT_SALE", party: { id: bittu }, amount: "3,200", vehicleNo: "7495", slipNo: "27593" });
    await entry(staff, { kind: "CREDIT_SALE", party: { name: "Chamkaur Singh" }, amount: "1,45,638", slipNo: "27578" });
    await entry(staff, { kind: "CUSTOMER_REPAYMENT", party: { name: "Deepak Garg" }, amount: "317764", mode: "CASH" });
    await entry(staff, { kind: "CUSTOMER_REPAYMENT", party: { name: "Gurminder" }, amount: "1000", mode: "CASH" });
    milkEntry = (await entry(staff, { kind: "EXPENSE", expenseCode: "6400", amount: "550", mode: "CASH", description: "milk" })).entryId;
    await entry(staff, { kind: "EXPENSE", expenseCode: "6500", amount: "1052", mode: "CASH", description: "misc" });
    await entry(staff, { kind: "SUPPLIER_PAYMENT", party: { name: "HPCL" }, amount: "10000", mode: "BANK_TRANSFER" });
    await entry(staff, { kind: "EXPENSE", expenseCode: "6500", amount: "400", mode: "UPI", description: "paid by UPI: not from the drawer" });
    // UPI / card: an udhari repayment by UPI, then the day's machine totals (UPI includes that repayment)
    await entry(staff, { kind: "CUSTOMER_REPAYMENT", party: { name: "Ravi UPI" }, amount: "5000", mode: "UPI" });
    await inTx(() => declareCollections(c, staff, { date: today, amounts: { UPI: "50,000", CARD: "20000" } }, key()));
    const s = await partyStatement(c, bittu);
    expect(s.balance).toBe("6250.00");
    expect(s.lines.map((l) => l.vehicle_no)).toEqual(["PB10AB3241", "7495"]);
  });

  it("refuses wrong entries", async () => {
    await expect(entry(staff, { kind: "OWNER_CAPITAL", amount: "1000", mode: "CASH" })).rejects.toThrow(/not allowed/);
    await expect(entry(staff, { kind: "CUSTOMER_REPAYMENT", party: { id: bittu }, amount: "100", mode: "CUSTOMER_CREDIT" })).rejects.toThrow(/how the money was paid/);
    await expect(entry(staff, { kind: "CREDIT_SALE", party: { name: "Someone", phone: "9876543210" }, amount: "10" })).rejects.toThrow(/already belongs to "Bittu Khan"/);
    await expect(entry(staff, { kind: "EXPENSE", expenseCode: "4100", amount: "10", mode: "CASH" })).rejects.toThrow(/expense type/);
    await expect(entry(staff, { kind: "EXPENSE", expenseCode: "6400", amount: "12.345", mode: "CASH" })).rejects.toThrow(/Amount/);
  });

  it("a double tap saves the entry once", async () => {
    const kk = key();
    const body = { kind: "LUBE_SALE", amount: "450", mode: "CASH" } as const;
    const run = () => inTx(() => runIdempotent(c, { key: kk, userId: staff.id, endpoint: "entries", body }, () => createEntry(c, staff, body, kk)));
    const a = await run();
    const b = await run();
    expect(b.replayed).toBe(true);
    expect((await c.query("SELECT count(*)::int n FROM money_entries WHERE kind = 'LUBE_SALE'")).rows[0].n).toBe(1);
    expect(a.response.entryId).toBe(b.response.entryId);
  });

  it("owner can cancel a wrong entry (reversal); staff cannot; it cannot be cancelled twice", async () => {
    const wrong = await entry(staff, { kind: "EXPENSE", expenseCode: "6400", amount: "5500", mode: "CASH", description: "typed 5500 instead of 550" });
    await expect(inTx(() => reverseEntry(c, staff, { entryId: wrong.entryId, reason: "typing mistake" }))).rejects.toThrow(/not allowed/);
    await inTx(() => reverseEntry(c, owner, { entryId: wrong.entryId, reason: "typing mistake" }));
    await expect(inTx(() => reverseEntry(c, owner, { entryId: wrong.entryId, reason: "again please" }))).rejects.toThrow(/already cancelled/);
    expect(milkEntry).not.toBe(wrong.entryId);
  });

  it("daily balance matches the register's formula", async () => {
    for (const [label, , close] of DAY.slice(0, 5)) await dayEnd(label, close); // MS A2 still missing
    const b = await inTx(() => getDayBalance(c, today));
    expect(b.sales.missingReadings).toEqual(["Station 3 (Petrol) MS A2"]);
    // 5 nozzles: 178,765.90 + 182,278.32 + 389,862.55 + 98,979.07 + 72,673.52
    expect(b.sales.total).toBe("922559.36");
    expect(b.udhariGiven).toBe("151888.00");
    expect(b.udhariReceived).toBe("323764.00"); // incl. 5,000 by UPI
    expect(b.collections.find((x) => x.mode === "UPI")).toMatchObject({ total: "50000.00", alreadyEntered: "5000.00", sales: "45000.00" });
    expect(b.collections.find((x) => x.mode === "CARD")).toMatchObject({ total: "20000.00", sales: "20000.00" });
    expect(b.nonCashSales).toBe("65000.00");
    expect(b.paymentsAll).toBe("12002.00"); // 550 + 1052 cash + 10000 bank + 400 UPI; the cancelled 5500 is excluded
    expect(b.paymentsCash).toBe("1602.00"); // only cash expenses lower the cash in hand
    expect(b.cashSales).toBe("705671.36"); // 922,559.36 - 151,888 udhari - 65,000 UPI/card
    // cash: 770,671.36 + 318,764 + 450 (lube) - 1,602 (cash payments)
    expect(b.expectedCash).toBe("1023283.36"); // UPI repayment is not in the drawer
  });

  it("count -> submit; entries blocked until owner sends the day back", async () => {
    const r = await inTx(() => countCash(c, staff, { date: today, counted: "1023000" }, key()));
    expect(r.difference).toBe("-283.36");
    await expect(entry(staff, { kind: "EXPENSE", expenseCode: "6400", amount: "10", mode: "CASH" })).rejects.toThrow(/already counted/);
  });

  it("lock is refused while a reading is missing; owner sends back, reading added, recount", async () => {
    await expect(inTx(() => lockDay(c, owner, { date: today }))).rejects.toThrow(/Readings missing: Station 3 \(Petrol\) MS A2/);
    await expect(inTx(() => reopenDay(c, staff, today))).rejects.toThrow(/not allowed/);
    await inTx(() => reopenDay(c, owner, today));
    await dayEnd("S3:MS A2", "764439.42");
    const b = await inTx(() => getDayBalance(c, today));
    expect(b.sales.byFuel.PETROL.value).toBe("91351.71"); // register: 868.61 L x 105.17
    expect(b.sales.total).toBe("941237.55");
    expect(b.expectedCash).toBe("1041961.55");
    const r = await inTx(() => countCash(c, staff, { date: today, counted: "1041100" }, key()));
    expect(r.difference).toBe("-861.55");
  });

  it("staff may End day a CLEAN day (recount inside End day); it posts the day correctly and freezes it", async () => {
    const { integrityCode, difference } = await inTx(() => endDay(c, staff, { date: today, counted: "10,41,100" }, key()));
    expect(difference).toBe("-861.55");
    expect(integrityCode).toMatch(/^[0-9A-F]{8}$/);
    // fuel revenue = meter sales exactly; repayments / opening balances never in revenue
    expect(await bal("4100")).toBe("-91351.71");
    expect(await bal("4110")).toBe("-849885.84");
    expect(await bal("1900")).toBe("0.00"); // INV-13
    expect(await bal("1600")).toBe("861.55"); // shortage in suspense
    expect(await bal("6960")).toBe("0.00"); // never auto-expensed
    expect(await bal("1100")).toBe("0.00"); // drawer emptied by handover
    expect(await bal("1150")).toBe("1041100.00"); // counted cash with owner
    expect(await bal("1300")).toBe("50000.00"); // UPI account = exactly the UPI machine total (5,000 udhari + 45,000 fuel)
    expect(await bal("1310")).toBe("20000.00"); // card account = card machine total
    expect(await bal("2100")).toBe("10000.00"); // paid to HPCL: supplier balance, not an expense
    expect(await bal("6400")).toBe("550.00");
    const tb = await c.query("SELECT SUM(balance)::text s FROM v_trial_balance");
    expect(tb.rows[0].s).toBe("0.00");
    // frozen
    await expect(entry(staff, { kind: "LUBE_SALE", amount: "10", mode: "CASH" })).rejects.toThrow(/already counted|locked/);
    await expect(dayEnd("S3:MS A1", "1029999.00")).rejects.toThrow(/DAY_LOCKED/);
    const snap = await c.query("SELECT figures->>'expectedCash' AS e, integrity_code FROM day_snapshots WHERE business_date = $1", [today]);
    expect(snap.rows[0]).toEqual({ e: "1041961.55", integrity_code: integrityCode });
  });
});

describe("names", () => {
  it("a second customer with the same name needs a phone number; 'HPCL' every day is the same supplier", async () => {
    // tested on the name logic itself: today is already ended at this point, so no entry can be added
    const add = (kind: "CUSTOMER" | "SUPPLIER", p: { name: string; phone?: string }) => inTx(() => findOrCreateParty(c, owner.id, kind, p));
    await add("CUSTOMER", { name: "Sukhi Transport" });
    await expect(add("CUSTOMER", { name: "sukhi  transport" })).rejects.toThrow(/already exists/);
    await add("CUSTOMER", { name: "Sukhi Transport", phone: "9800011122" }); // a different person, told apart by phone
    const hpcl = (await c.query("SELECT id FROM parties WHERE kind = 'SUPPLIER' AND lower(name) = 'hpcl'")).rows[0].id; // paid earlier today
    expect(await add("SUPPLIER", { name: "hpcl" })).toBe(hpcl);
    expect((await c.query("SELECT count(*)::int n FROM parties WHERE kind = 'SUPPLIER' AND lower(name) = 'hpcl'")).rows[0].n).toBe(1);
  });
});
