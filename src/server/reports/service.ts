import type { ClientBase } from "pg";
import { Errors } from "../errors";
import { D, type Dec } from "../money";
import { ENTRY_KINDS, getDayBalance, goLiveDate } from "../money/service";

/** A statement period. Daily = from === to. */
export type Period = { from: string; to: string };

export function periodFrom(q: { type?: string; date?: string; month?: string; from?: string; to?: string }, today: string): Period & { type: "daily" | "monthly" | "custom"; label: string } {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const nice = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  if (q.type === "monthly") {
    const m = /^\d{4}-\d{2}$/.test(q.month ?? "") ? q.month! : today.slice(0, 7);
    const [y, mo] = m.split("-").map(Number);
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const label = new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
    return { type: "monthly", from: `${m}-01`, to: `${m}-${String(last).padStart(2, "0")}`, label };
  }
  if (q.type === "custom") {
    let from = iso.test(q.from ?? "") ? q.from! : today;
    let to = iso.test(q.to ?? "") ? q.to! : today;
    if (from > to) [from, to] = [to, from];
    return { type: "custom", from, to, label: `${nice(from)} to ${nice(to)}` };
  }
  const d = iso.test(q.date ?? "") ? q.date! : today;
  return { type: "daily", from: d, to: d, label: nice(d) };
}

const z = () => new D(0);
const s2 = (d: Dec) => d.toFixed(2);

/** One line of the day-wise register, from that day's balance. */
function dayRow(date: string, b: Awaited<ReturnType<typeof getDayBalance>>) {
  const col = (m: string) => b.collections.find((x) => x.mode === m)?.sales ?? "0.00";
  return {
    date,
    status: b.status,
    petrolL: b.sales.byFuel.PETROL?.litres ?? "0.000",
    dieselL: b.sales.byFuel.DIESEL?.litres ?? "0.000",
    petrol: b.sales.byFuel.PETROL?.value ?? "0.00",
    diesel: b.sales.byFuel.DIESEL?.value ?? "0.00",
    fuelSales: b.sales.total,
    udhariGiven: b.udhariGiven,
    upi: col("UPI"),
    card: col("CARD"),
    bankOther: s2(new D(col("BANK")).plus(col("OTHER"))),
    nonCash: b.nonCashSales,
    cashSales: b.cashSales,
    udhariReceived: b.udhariReceived,
    otherIncome: b.otherIn,
    expensesCash: b.paymentsCash,
    expensesOther: b.paymentsNonCash,
    expectedCash: b.expectedCash,
    counted: b.counted,
    difference: b.difference,
    readingsMissing: b.sales.missingReadings.length,
  };
}

/**
 * Period statement, laid out the way an accountant reports a petrol pump:
 * summary, day-wise register, expenses by head, cash book, debtors (udhari), day book.
 * Fuel sales come from the nozzle readings; money from the posted entries. Days not yet ended are
 * included but marked, so the reader knows those figures can still change.
 */
export async function periodStatement(c: ClientBase, p: Period) {
  if (p.from > p.to) throw Errors.badInput("From date is after To date.");
  const days366 = (Date.parse(p.to) - Date.parse(p.from)) / 86400000;
  if (days366 > 366) throw Errors.badInput("Choose a period of at most one year.");
  const site = (await c.query("SELECT id, name, address FROM sites WHERE active ORDER BY created_at LIMIT 1")).rows[0];
  if (!site) throw Errors.badInput("Set up the pump first.");
  const goLive = await goLiveDate(c);

  // every business day in the period that has anything recorded
  const active = (
    await c.query(
      `SELECT d::text AS d FROM (
         SELECT business_date AS d FROM business_days WHERE site_id = $1 AND business_date BETWEEN $2 AND $3
         UNION SELECT business_date FROM money_entries WHERE site_id = $1 AND business_date BETWEEN $2 AND $3
         UNION SELECT business_date FROM meter_points WHERE point_type = 'DAY_END' AND business_date BETWEEN $2 AND $3
       ) x ORDER BY d`,
      [site.id, p.from, p.to],
    )
  ).rows
    .map((r) => r.d as string)
    // days up to go-live only hold the imported old balances: they are not business days of the app
    .filter((d) => !goLive || d > goLive);

  const days: Array<ReturnType<typeof dayRow>> = [];
  for (const d of active) days.push(dayRow(d, await getDayBalance(c, d)));
  const tot = (k: keyof (typeof days)[number]) => s2(days.reduce((a, x) => a.plus((x[k] as string | null) ?? "0"), z()));
  const totals = {
    petrolL: new D(tot("petrolL")).toFixed(3),
    dieselL: new D(tot("dieselL")).toFixed(3),
    petrol: tot("petrol"),
    diesel: tot("diesel"),
    fuelSales: tot("fuelSales"),
    udhariGiven: tot("udhariGiven"),
    upi: tot("upi"),
    card: tot("card"),
    bankOther: tot("bankOther"),
    nonCash: tot("nonCash"),
    cashSales: tot("cashSales"),
    udhariReceived: tot("udhariReceived"),
    otherIncome: tot("otherIncome"),
    expensesCash: tot("expensesCash"),
    expensesOther: tot("expensesOther"),
    expectedCash: tot("expectedCash"),
    counted: tot("counted"),
    difference: tot("difference"),
  };

  // entries in the period (not cancelled)
  const entries = (
    await c.query(
      `SELECT m.entry_no::text, m.business_date::text AS date, m.kind, m.mode_code AS mode, m.amount::text, m.vehicle_no, m.slip_no,
              m.description, p.name AS party, a.name_en AS head, u.name AS by, (r.id IS NOT NULL) AS cancelled
         FROM money_entries m LEFT JOIN parties p ON p.id = m.party_id LEFT JOIN accounts a ON a.id = m.expense_account_id
         JOIN users u ON u.id = m.entered_by LEFT JOIN money_entry_reversals r ON r.money_entry_id = m.id
        WHERE m.site_id = $1 AND m.business_date BETWEEN $2 AND $3 ORDER BY m.business_date, m.entry_no`,
      [site.id, p.from, p.to],
    )
  ).rows as Array<{ entry_no: string; date: string; kind: keyof typeof ENTRY_KINDS; mode: string; amount: string; vehicle_no: string | null; slip_no: string | null;
    description: string | null; party: string | null; head: string | null; by: string; cancelled: boolean }>;
  const live = entries.filter((e) => !e.cancelled);

  // expenses and other payments by head, cash vs UPI / bank
  const heads = new Map<string, { head: string; cash: Dec; other: Dec }>();
  for (const e of live.filter((x) => ENTRY_KINDS[x.kind].dir === "OUT")) {
    const head =
      e.kind === "EXPENSE" ? e.head! : e.kind === "SUPPLIER_PAYMENT" ? `Paid to ${e.party}` : ENTRY_KINDS[e.kind].en;
    const h = heads.get(head) ?? { head, cash: z(), other: z() };
    if (e.mode === "CASH") h.cash = h.cash.plus(e.amount);
    else h.other = h.other.plus(e.amount);
    heads.set(head, h);
  }
  const expenseHeads = [...heads.values()]
    .map((h) => ({ head: h.head, cash: s2(h.cash), other: s2(h.other), total: s2(h.cash.plus(h.other)) }))
    .sort((a, b) => a.head.localeCompare(b.head));
  const incomeHeads = new Map<string, { head: string; cash: Dec; other: Dec }>();
  for (const e of live.filter((x) => x.kind === "LUBE_SALE" || x.kind === "OTHER_INCOME" || x.kind === "LOAN_RECEIVED" || x.kind === "OWNER_CAPITAL")) {
    const head = ENTRY_KINDS[e.kind].en;
    const h = incomeHeads.get(head) ?? { head, cash: z(), other: z() };
    if (e.mode === "CASH") h.cash = h.cash.plus(e.amount);
    else h.other = h.other.plus(e.amount);
    incomeHeads.set(head, h);
  }

  // cash book from the posted journal (cash drawer 1100 + cash handed to owner 1150)
  const cashAcc = `SELECT id FROM accounts WHERE code IN ('1100','1150')`;
  const openingCash = (
    await c.query(
      `SELECT COALESCE(SUM(l.debit - l.credit),0)::numeric(14,2)::text v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.account_id IN (${cashAcc}) AND e.business_date < $1 AND e.source_type <> 'INTERNAL_TRANSFER'`,
      [p.from],
    )
  ).rows[0].v as string;
  const cashMoves = (
    await c.query(
      `SELECT e.source_type, SUM(l.debit)::numeric(14,2)::text AS dr, SUM(l.credit)::numeric(14,2)::text AS cr
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.account_id IN (${cashAcc}) AND e.business_date BETWEEN $1 AND $2 AND e.source_type <> 'INTERNAL_TRANSFER'
        GROUP BY e.source_type ORDER BY e.source_type`,
      [p.from, p.to],
    )
  ).rows as Array<{ source_type: string; dr: string; cr: string }>;
  const CASH_LABEL: Record<string, string> = {
    SALES_SETTLEMENT: "Cash fuel sales (ended days)",
    CUSTOMER_REPAYMENT: "Udhari received in cash",
    OTHER_RECEIPT: "Lube / other income in cash",
    LOAN_RECEIVED: "Loan received",
    OWNER_CAPITAL: "Owner put in",
    EXPENSE_PAYMENT: "Expenses paid in cash",
    SUPPLIER_PAYMENT: "Paid to suppliers in cash",
    BANK_DEPOSIT: "Deposited in bank",
    SALARY_PAYMENT: "Salaries paid in cash",
    STAFF_ADVANCE: "Staff advances",
    OWNER_DRAWING: "Taken by owner",
    LOAN_REPAYMENT: "Loan repaid",
    CASH_COUNT_DIFFERENCE: "Cash short (−) / excess (+) at count",
    REVERSAL: "Cancelled entries",
    OPENING_BALANCE: "Opening cash",
  };
  // receipts first, then payments (as in a cash book); each side largest first
  const cashBook = cashMoves
    .map((m) => ({ label: CASH_LABEL[m.source_type] ?? m.source_type, receipts: m.dr, payments: m.cr, net: new D(m.dr).minus(m.cr) }))
    .sort((a, b) => (a.net.gte(0) === b.net.gte(0) ? b.net.abs().cmp(a.net.abs()) : a.net.gte(0) ? -1 : 1))
    .map(({ label, receipts, payments }) => ({ label, receipts, payments }));
  const closingCash = s2(cashMoves.reduce((a, m) => a.plus(m.dr).minus(m.cr), new D(openingCash)));

  // debtors (udhari)
  const debtors = (
    await c.query(
      `SELECT p.id, p.name, p.phone,
              COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.business_date < $1), 0)::numeric(14,2)::text AS opening,
              COALESCE(SUM(l.debit) FILTER (WHERE e.business_date BETWEEN $1 AND $2), 0)::numeric(14,2)::text AS debit,
              COALESCE(SUM(l.credit) FILTER (WHERE e.business_date BETWEEN $1 AND $2), 0)::numeric(14,2)::text AS credit,
              COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.business_date <= $2), 0)::numeric(14,2)::text AS closing
         FROM parties p JOIN journal_lines l ON l.party_id = p.id JOIN journal_entries e ON e.id = l.entry_id
        WHERE p.kind = 'CUSTOMER'
        GROUP BY p.id ORDER BY lower(p.name)`,
      [p.from, p.to],
    )
  ).rows.filter((r) => r.opening !== "0.00" || r.debit !== "0.00" || r.credit !== "0.00" || r.closing !== "0.00") as Array<{
    id: string; name: string; phone: string | null; opening: string; debit: string; credit: string; closing: string;
  }>;
  const dsum = (k: "opening" | "debit" | "credit" | "closing") => s2(debtors.reduce((a, r) => a.plus(r[k]), z()));

  return {
    pump: { name: site.name as string, address: site.address as string | null },
    period: p,
    generatedAt: new Date().toISOString(),
    days,
    totals,
    notEnded: days.filter((x) => x.status !== "LOCKED").map((x) => x.date),
    incomeHeads: [...incomeHeads.values()].map((h) => ({ head: h.head, cash: s2(h.cash), other: s2(h.other), total: s2(h.cash.plus(h.other)) })),
    expenseHeads,
    expenseTotal: s2(expenseHeads.reduce((a, h) => a.plus(h.total), z())),
    cash: { opening: openingCash, lines: cashBook, closing: closingCash },
    debtors: { rows: debtors, opening: dsum("opening"), debit: dsum("debit"), credit: dsum("credit"), closing: dsum("closing") },
    dayBook: entries,
  };
}
export type Statement = Awaited<ReturnType<typeof periodStatement>>;

/** One customer's ledger for a period: balance brought forward, entries, closing balance. */
export async function customerLedger(c: ClientBase, partyId: string, p: Period) {
  const party = (await c.query("SELECT id, name, phone, address FROM parties WHERE id = $1 AND kind = 'CUSTOMER'", [partyId])).rows[0];
  if (!party) throw Errors.badInput("Customer not found.");
  const bf = (
    await c.query(
      `SELECT COALESCE(SUM(l.debit - l.credit),0)::numeric(14,2)::text v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.party_id = $1 AND e.business_date < $2`,
      [partyId, p.from],
    )
  ).rows[0].v as string;
  const rows = (
    await c.query(
      `SELECT e.business_date::text AS date, e.entry_no::text AS ref, e.source_type, e.narration, l.debit::text, l.credit::text, l.vehicle_no,
              m.slip_no, m.mode_code AS mode, l.litres::text
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         LEFT JOIN money_entries m ON m.id = e.source_id
        WHERE l.party_id = $1 AND e.business_date BETWEEN $2 AND $3 ORDER BY e.business_date, e.entry_no`,
      [partyId, p.from, p.to],
    )
  ).rows;
  let bal = new D(bf);
  const DESC: Record<string, string> = {
    CREDIT_SALE: "Fuel on credit",
    CUSTOMER_REPAYMENT: "Payment received",
    OPENING_BALANCE: "Opening balance (old register)",
    REVERSAL: "Entry cancelled",
  };
  const lines = rows.map((r) => {
    bal = bal.plus(r.debit).minus(r.credit);
    const MODE: Record<string, string> = { CASH: "Cash", UPI: "UPI", PAYTM: "UPI", BANK_TRANSFER: "Bank", DEBIT_CARD: "Card", CREDIT_CARD: "Card", OTHER: "Other" };
    const extra = [r.vehicle_no, r.slip_no ? `slip ${r.slip_no}` : null, r.source_type === "CUSTOMER_REPAYMENT" && r.mode ? (MODE[r.mode] ?? r.mode) : null]
      .filter(Boolean)
      .join(" · ");
    return { date: r.date, particulars: DESC[r.source_type] ?? r.source_type, detail: extra, debit: r.debit, credit: r.credit, balance: s2(bal) };
  });
  const debit = s2(rows.reduce((a, r) => a.plus(r.debit), z()));
  const credit = s2(rows.reduce((a, r) => a.plus(r.credit), z()));
  return { party, period: p, broughtForward: bf, lines, debit, credit, closing: s2(bal) };
}
export type Ledger = Awaited<ReturnType<typeof customerLedger>>;

/** Indian accounting style: 12,500.00 Dr / 1,000.00 Cr. */
export function drcr(v: string): string {
  const d = new D(v);
  if (d.isZero()) return "0.00";
  const [i, f] = d.abs().toFixed(2).split(".");
  const last3 = i.slice(-3);
  const rest = i.slice(0, -3);
  const g = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${g}.${f} ${d.isNeg() ? "Cr" : "Dr"}`;
}
