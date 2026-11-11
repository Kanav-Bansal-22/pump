import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createUser } from "@/server/auth/service";
import { createStandardLayout } from "@/server/config/service";
import { addOpeningBalance, confirmImport, parseSignedAmount, previewImport, templateXlsx } from "@/server/money/opening";
import { setBaseline } from "@/server/meters/service";
import { createEntry, goLiveDate, partyStatement } from "@/server/money/service";
import { connect, tx } from "./helpers/db";

let c: Client;
let owner: { id: string; role: string; permissions: string[] };
let siteId = "";
let today = "";
let k = 0;
const key = () => `import-test-${Date.now()}-${++k}-xxxxxxxx`;

async function inTx<T>(fn: () => Promise<T>): Promise<T> {
  let out: T;
  const err = await tx(c, async () => {
    out = await fn();
  });
  if (err) throw new Error(err);
  return out!;
}
const csv = (lines: string[]) => Buffer.from(lines.join("\r\n"), "utf8").toString("base64");
const preview = (b64: string, fileName = "old-register.csv") => inTx(() => previewImport(c, owner, { fileName, fileBase64: b64, openingDate: today }));
const revenue = async () =>
  (await c.query("SELECT COALESCE(SUM(l.credit - l.debit),0)::numeric(14,2)::text AS r FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.type = 'INCOME'")).rows[0].r;

beforeAll(async () => {
  c = await connect("app", "pump_test_import");
  const id = await inTx(() => createUser(c, { name: "Owner I", username: "owner_i", tempPassword: "owner-pass-1", role: "OWNER" }));
  owner = { id, role: "OWNER", permissions: (await c.query("SELECT permission_code FROM v_user_permissions WHERE user_id = $1", [id])).rows.map((r) => r.permission_code) };
  await inTx(() => createStandardLayout(c, "Import Test Pump"));
  siteId = (await c.query("SELECT id FROM sites LIMIT 1")).rows[0].id;
  today = (
    await c.query(
      "SELECT CASE WHEN (now() AT TIME ZONE 'Asia/Kolkata')::time >= '08:00' THEN (now() AT TIME ZONE 'Asia/Kolkata')::date ELSE (now() AT TIME ZONE 'Asia/Kolkata')::date - 1 END::text d",
    )
  ).rows[0].d;
});
afterAll(async () => {
  await c.end();
});

describe("starting readings (go-live)", () => {
  it("open the business day in progress whatever the time: the first app day is today, and today can be ended later", async () => {
    const n = (await c.query("SELECT id FROM nozzles ORDER BY sort_order LIMIT 1")).rows[0].id;
    await inTx(() => setBaseline(c, owner.id, { nozzleId: n, reading: "1847703.80", idempotencyKey: key() }));
    const p = await c.query("SELECT business_date::text d FROM meter_points WHERE nozzle_id = $1", [n]);
    const prev = (await c.query("SELECT ($1::date - 1)::text d", [today])).rows[0].d;
    expect(p.rows[0].d).toBe(prev); // closes the day before today
    expect(await inTx(() => goLiveDate(c))).toBe(prev); // so today is the first app day
  });
});

describe("amount reading", () => {
  it.each([
    ["1,80,000", "180000.00"],
    ["₹ 3050.5", "3050.50"],
    ["-500", "-500.00"],
    ["500 Cr", "-500.00"],
    ["1200 Dr", "1200.00"],
    ["(250)", "-250.00"],
    ["0", "0.00"],
    ["abc", null],
    ["12.345", null],
  ])("%s -> %s", (raw, out) => expect(parseSignedAmount(raw)).toBe(out));
});

describe("opening balance import", () => {
  it("existing customer added in the app before go-live is matched, not duplicated", async () => {
    // Deepak Garg paid old udhari during go-live week, before the import (shows as an advance)
    await inTx(() =>
      createEntry(c, owner, { kind: "CUSTOMER_REPAYMENT", party: { name: "Deepak  Garg" }, amount: "317764", mode: "CASH" }, key()),
    );
  });

  it("preview flags every problem and blocks confirmation until the file is fixed", async () => {
    const p = await preview(
      csv([
        "Name,Phone,Address,Amount,Remarks",
        "EXAMPLE: delete this row,9800000000,,0,",
        "Bittu Khan,98765 43210,Mansa,\"12,500\",",
        "Chamkaur Singh,,,abc,",
        "Ram Lal,,,700,",
        "Ram Lal,,,300,",
        "Short Phone,12345,,100,",
        ",,,,", // blank line is skipped
      ]),
    );
    expect(p.rows.map((r) => [r.rowNo, r.status, r.error ?? ""])).toEqual([
      [2, "ERROR", "This is the template's example row: delete it"],
      [3, "NEW", ""],
      [4, "ERROR", 'Amount "abc" is not a number'],
      [5, "ERROR", "Same name appears more than once in the file: add phone numbers to tell them apart"],
      [6, "ERROR", "Same name appears more than once in the file: add phone numbers to tell them apart"],
      [7, "ERROR", 'Phone "12345" must have 10 digits'],
    ]);
    await expect(inTx(() => confirmImport(c, owner, { batchId: p.batchId, registerTotal: "12500" }))).rejects.toThrow(/5 row\(s\) have problems/);
  });

  let fixed = "";
  it("a clean file: register total must match before anything is posted", async () => {
    fixed = csv([
      "Customer Name,Mobile No,Address,Opening Balance,Remarks",
      "Bittu Khan,9876543210,Mansa,\"12,500\",two trucks",
      "deepak garg,,,\"3,17,764\",",
      "Chamkaur Singh,9812345678,,\"1,45,638\",",
      "Gurminder,,,-1000,paid in advance",
      "Ram Lal,9888877777,,0,settled",
    ]);
    const p = await preview(fixed);
    expect(p.counts).toEqual({ NEW: 4, MATCH_EXISTING: 1, ERROR: 0 });
    // the name was typed "Deepak  Garg" in the app (stored tidied) and "deepak garg" in the file
    expect(p.rows.find((r) => r.rowNo === 3)).toMatchObject({ status: "MATCH_EXISTING", matchName: "Deepak Garg" });
    expect(p.total).toBe("474902.00");
    expect(p.owing).toBe("475902.00");
    expect(p.advance).toBe("-1000.00");
    await expect(inTx(() => confirmImport(c, owner, { batchId: p.batchId, registerTotal: "4,74,000" }))).rejects.toThrow(/register says ₹4,74,000.00. The file is ₹902.00 more/);

    const rev = await revenue();
    const r = await inTx(() => confirmImport(c, owner, { batchId: p.batchId, registerTotal: "4,74,902" }));
    expect(r).toEqual({ created: 4, matched: 1, total: "474902.00" });
    expect(await revenue()).toBe(rev); // opening balances are never revenue (INV-04)
  });

  it("balances are right, and the earlier repayment now nets against the old balance", async () => {
    const parties = Object.fromEntries((await c.query("SELECT name, id FROM parties")).rows.map((r) => [r.name, r.id]));
    expect((await partyStatement(c, parties["Deepak Garg"])).balance).toBe("0.00"); // 3,17,764 old - 3,17,764 paid
    expect((await partyStatement(c, parties["Bittu Khan"])).balance).toBe("12500.00");
    expect((await partyStatement(c, parties["Gurminder"])).balance).toBe("-1000.00"); // advance
    expect((await partyStatement(c, parties["Ram Lal"])).balance).toBe("0.00");
    expect((await c.query("SELECT count(*)::int n FROM parties WHERE kind = 'CUSTOMER'")).rows[0].n).toBe(5); // no duplicate Deepak
    const tb = await c.query("SELECT SUM(balance)::text s FROM v_trial_balance");
    expect(tb.rows[0].s).toBe("0.00");
  });

  it("the same file can never be imported twice", async () => {
    await expect(preview(fixed)).rejects.toThrow(/already imported/);
  });

  it("a different file cannot give a customer a second old balance", async () => {
    const p = await preview(csv(["Name,Phone,Amount", "Bittu Khan,9876543210,999"]));
    expect(p.rows[0]).toMatchObject({ status: "ERROR", error: '"Bittu Khan" already has an old balance in the app' });
    const pid = (await c.query("SELECT id FROM parties WHERE name = 'Bittu Khan'")).rows[0].id;
    await expect(inTx(() => addOpeningBalance(c, owner, { siteId, partyId: pid, amount: "50", date: today }))).rejects.toThrow(/already has an old balance/);
  });

  it("reads the Excel template format (.xlsx)", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await templateXlsx()) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    ws.spliceRows(2, 1); // owner deletes the example row
    ws.addRow(["Naresh Kumar", "9811122233", "Bhikhi", 2250.5, ""]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const p = await preview(buf.toString("base64"), "register.xlsx");
    expect(p.rows).toEqual([{ rowNo: 2, name: "Naresh Kumar", phone: "9811122233", amount: "2250.50", status: "NEW", matchName: undefined, error: undefined }]);
  });

  it("imported rows and batches cannot be edited or deleted", async () => {
    await expect(c.query("UPDATE import_rows SET amount = 1")).rejects.toThrow(/permission denied/);
    await expect(c.query("DELETE FROM opening_balances")).rejects.toThrow(/permission denied/);
    const b = (await c.query("SELECT id FROM import_batches WHERE status = 'CONFIRMED'")).rows[0].id;
    await expect(c.query("UPDATE import_batches SET status = 'CANCELLED' WHERE id = $1", [b])).rejects.toThrow(/not allowed/);
  });
});
