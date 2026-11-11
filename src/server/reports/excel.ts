import ExcelJS from "exceljs";
import { ENTRY_KINDS } from "../money/service";
import type { Ledger, Statement } from "./service";

const MONEY = "#,##0.00";
const LITRES = "#,##0.000";
const n = (v: string | null | undefined) => (v == null || v === "" ? null : Number(v)); // export only: exact strings -> Excel numbers

function header(ws: ExcelJS.Worksheet, lines: string[], cols: number) {
  lines.forEach((t, i) => {
    const r = ws.addRow([t]);
    ws.mergeCells(r.number, 1, r.number, cols);
    r.font = { bold: i < 2, size: i === 0 ? 14 : 11 };
    r.alignment = { horizontal: "center" };
  });
  ws.addRow([]);
}

function table(ws: ExcelJS.Worksheet, head: string[], rows: Array<Array<string | number | null>>, formats: Array<string | null>, total?: Array<string | number | null>) {
  const h = ws.addRow(head);
  h.font = { bold: true };
  h.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF5" } };
    cell.border = { bottom: { style: "thin" } };
  });
  for (const r of rows) {
    const row = ws.addRow(r);
    formats.forEach((f, i) => f && (row.getCell(i + 1).numFmt = f));
  }
  if (total) {
    const t = ws.addRow(total);
    t.font = { bold: true };
    t.eachCell((cell) => (cell.border = { top: { style: "thin" } }));
    formats.forEach((f, i) => f && (t.getCell(i + 1).numFmt = f));
  }
  ws.addRow([]);
}

/** The period statement as an Excel workbook (one sheet per section). */
export async function statementXlsx(s: Statement, label: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = s.pump.name;
  const title = [s.pump.name, `Statement of Accounts: ${label}`, `Generated ${new Date(s.generatedAt).toLocaleString("en-IN")} · amounts in ₹`];
  const t = s.totals;

  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ width: 38 }, { width: 14 }, { width: 16 }];
  header(sum, s.notEnded.length ? [...title, `Not yet ended: ${s.notEnded.join(", ")}`] : title, 3);
  table(
    sum,
    ["Sales & income", "Litres", "Amount"],
    [
      ["Petrol (MS) sales", n(t.petrolL), n(t.petrol)],
      ["Diesel (HSD) sales", n(t.dieselL), n(t.diesel)],
      ...s.incomeHeads.map((h) => [h.head, null, n(h.total)]),
    ],
    [null, LITRES, MONEY],
    ["Total fuel sales", null, n(t.fuelSales)],
  );
  table(
    sum,
    ["Fuel sales received by", "", "Amount"],
    [
      ["Cash", null, n(t.cashSales)],
      ["UPI", null, n(t.upi)],
      ["Card", null, n(t.card)],
      ["Bank / other", null, n(t.bankOther)],
      ["Credit (udhari given)", null, n(t.udhariGiven)],
    ],
    [null, null, MONEY],
    ["Total = fuel sales", null, n(t.fuelSales)],
  );
  table(sum, ["Other", "", "Amount"], [["Udhari received (collection of credit)", null, n(t.udhariReceived)], ["Expenses & payments", null, n(s.expenseTotal)]], [null, null, MONEY]);

  const dw = wb.addWorksheet("Day-wise");
  const dwHead = ["Date", "Status", "Petrol L", "Diesel L", "Fuel sales", "Udhari given", "UPI", "Card", "Bank/other", "Cash sales", "Udhari recd", "Lube/other", "Exp. cash", "Exp. UPI/bank", "Cash expected", "Counted", "Short(-)/excess"];
  dw.columns = dwHead.map((_, i) => ({ width: i < 2 ? 12 : 14 }));
  header(dw, title, dwHead.length);
  const f = [null, null, LITRES, LITRES, ...Array(13).fill(MONEY)];
  table(
    dw,
    dwHead,
    s.days.map((d) => [d.date, d.status === "LOCKED" ? "ended" : "open", n(d.petrolL), n(d.dieselL), n(d.fuelSales), n(d.udhariGiven), n(d.upi), n(d.card), n(d.bankOther), n(d.cashSales), n(d.udhariReceived), n(d.otherIncome), n(d.expensesCash), n(d.expensesOther), n(d.expectedCash), n(d.counted), n(d.difference)]),
    f,
    ["Total", "", n(t.petrolL), n(t.dieselL), n(t.fuelSales), n(t.udhariGiven), n(t.upi), n(t.card), n(t.bankOther), n(t.cashSales), n(t.udhariReceived), n(t.otherIncome), n(t.expensesCash), n(t.expensesOther), n(t.expectedCash), n(t.counted), n(t.difference)],
  );

  const ex = wb.addWorksheet("Expenses");
  ex.columns = [{ width: 34 }, { width: 14 }, { width: 14 }, { width: 14 }];
  header(ex, title, 4);
  table(ex, ["Head", "Cash", "UPI / bank", "Total"], s.expenseHeads.map((h) => [h.head, n(h.cash), n(h.other), n(h.total)]), [null, MONEY, MONEY, MONEY], ["Total", n(t.expensesCash), n(t.expensesOther), n(s.expenseTotal)]);

  const cb = wb.addWorksheet("Cash book");
  cb.columns = [{ width: 40 }, { width: 16 }, { width: 16 }];
  header(cb, [...title, "Only ended days (a day's cash sales are posted when it is ended)"], 3);
  table(cb, ["Particulars", "Receipts", "Payments"], [["Opening cash (b/f)", n(s.cash.opening), null], ...s.cash.lines.map((l) => [l.label, n(l.receipts), n(l.payments)])], [null, MONEY, MONEY], ["Closing cash (c/f)", null, n(s.cash.closing)]);

  const dr = wb.addWorksheet("Udhari");
  dr.columns = [{ width: 30 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }];
  header(dr, title, 6);
  table(
    dr,
    ["Customer", "Phone", "Opening (Dr+/Cr-)", "Debit (given)", "Credit (received)", "Closing (Dr+/Cr-)"],
    s.debtors.rows.map((r) => [r.name, r.phone ?? "", n(r.opening), n(r.debit), n(r.credit), n(r.closing)]),
    [null, null, MONEY, MONEY, MONEY, MONEY],
    ["Total", "", n(s.debtors.opening), n(s.debtors.debit), n(s.debtors.credit), n(s.debtors.closing)],
  );

  const db = wb.addWorksheet("Day book");
  db.columns = [{ width: 12 }, { width: 8 }, { width: 22 }, { width: 24 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 22 }, { width: 10 }];
  header(db, title, 10);
  table(
    db,
    ["Date", "#", "Entry", "Name", "Head", "Vehicle", "Mode", "Amount", "Details", "Cancelled"],
    s.dayBook.map((e) => [e.date, Number(e.entry_no), ENTRY_KINDS[e.kind].en, e.party ?? "", e.head ?? "", e.vehicle_no ?? "", e.mode, n(e.amount), e.description ?? "", e.cancelled ? "yes" : ""]),
    [null, null, null, null, null, null, null, MONEY, null, null],
  );
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** One or many customer ledgers (one sheet each). */
export async function ledgersXlsx(pump: string, ledgers: Ledger[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const used = new Set<string>();
  for (const l of ledgers) {
    let name = l.party.name.replace(/[\\/*?:[\]]/g, " ").slice(0, 28) || "Customer";
    while (used.has(name)) name = `${name.slice(0, 25)}_${used.size}`;
    used.add(name);
    const ws = wb.addWorksheet(name);
    ws.columns = [{ width: 12 }, { width: 30 }, { width: 26 }, { width: 14 }, { width: 14 }, { width: 18 }];
    header(ws, [pump, `Ledger: ${l.party.name}${l.party.phone ? ` (${l.party.phone})` : ""}`, `${l.period.from} to ${l.period.to}`], 6);
    table(
      ws,
      ["Date", "Particulars", "Details", "Debit", "Credit", "Balance (Dr+/Cr-)"],
      [["", "Balance brought forward", "", null, null, n(l.broughtForward)], ...l.lines.map((x) => [x.date, x.particulars, x.detail, n(x.debit) || null, n(x.credit) || null, n(x.balance)])],
      [null, null, null, MONEY, MONEY, MONEY],
      ["", "Total / closing balance", "", n(l.debit), n(l.credit), n(l.closing)],
    );
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
