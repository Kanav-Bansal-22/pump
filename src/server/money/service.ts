import { createHash, randomUUID } from "node:crypto";
import type { ClientBase } from "pg";
import { AppError, Errors } from "../errors";
import { D, parseAmount, type Dec } from "../money";

// ---------------------------------------------------------------------------
// Entry kinds (one per kind of line in the Rokad)
// ---------------------------------------------------------------------------
export const ENTRY_KINDS = {
  CREDIT_SALE: { dir: "CREDIT", en: "Udhari given", hi: "उधारी दी", party: "CUSTOMER", ownerOnly: false, perm: "credit.create" },
  CUSTOMER_REPAYMENT: { dir: "IN", en: "Udhari received", hi: "उधारी मिली", party: "CUSTOMER", ownerOnly: false, perm: "receipt.create" },
  LUBE_SALE: { dir: "IN", en: "Lubricant / other product sale", hi: "लुब्रिकेंट बिक्री", party: null, ownerOnly: false, perm: "receipt.create" },
  OTHER_INCOME: { dir: "IN", en: "Other income", hi: "अन्य आय", party: null, ownerOnly: false, perm: "receipt.create" },
  LOAN_RECEIVED: { dir: "IN", en: "Loan received", hi: "ऋण मिला", party: "LENDER", ownerOnly: true, perm: "receipt.create" },
  OWNER_CAPITAL: { dir: "IN", en: "Money put in by owner", hi: "मालिक ने पैसा डाला", party: null, ownerOnly: true, perm: "receipt.create" },
  EXPENSE: { dir: "OUT", en: "Expense", hi: "खर्च", party: null, ownerOnly: false, perm: "payment.create" },
  SUPPLIER_PAYMENT: { dir: "OUT", en: "Paid to supplier (HPCL etc.)", hi: "सप्लायर को भुगतान", party: "SUPPLIER", ownerOnly: false, perm: "payment.create" },
  BANK_DEPOSIT: { dir: "OUT", en: "Cash deposited in bank", hi: "बैंक में जमा", party: null, ownerOnly: false, perm: "payment.create" },
  SALARY: { dir: "OUT", en: "Salary paid", hi: "वेतन", party: null, ownerOnly: true, perm: "payment.create" },
  STAFF_ADVANCE: { dir: "OUT", en: "Advance to staff", hi: "कर्मचारी अग्रिम", party: "EMPLOYEE", ownerOnly: true, perm: "payment.create" },
  OWNER_DRAWING: { dir: "OUT", en: "Taken by owner", hi: "मालिक ने लिया", party: null, ownerOnly: true, perm: "payment.create" },
  LOAN_REPAYMENT: { dir: "OUT", en: "Loan repaid", hi: "ऋण चुकाया", party: "LENDER", ownerOnly: true, perm: "payment.create" },
} as const;
export type EntryKind = keyof typeof ENTRY_KINDS;

const SOURCE: Record<EntryKind, string> = {
  CREDIT_SALE: "CREDIT_SALE",
  CUSTOMER_REPAYMENT: "CUSTOMER_REPAYMENT",
  LUBE_SALE: "OTHER_RECEIPT",
  OTHER_INCOME: "OTHER_RECEIPT",
  LOAN_RECEIVED: "LOAN_RECEIVED",
  OWNER_CAPITAL: "OWNER_CAPITAL",
  EXPENSE: "EXPENSE_PAYMENT",
  SUPPLIER_PAYMENT: "SUPPLIER_PAYMENT",
  BANK_DEPOSIT: "BANK_DEPOSIT",
  SALARY: "SALARY_PAYMENT",
  STAFF_ADVANCE: "STAFF_ADVANCE",
  OWNER_DRAWING: "OWNER_DRAWING",
  LOAN_REPAYMENT: "LOAN_REPAYMENT",
};

/** Where money of each mode lands (receipts) or leaves from (payments). */
function modeAccount(mode: string, dir: "IN" | "OUT"): string {
  if (mode === "CASH") return "1100";
  if (dir === "IN" && (mode === "UPI" || mode === "PAYTM")) return "1300";
  if (dir === "IN" && (mode === "DEBIT_CARD" || mode === "CREDIT_CARD")) return "1310";
  return "1200"; // bank transfer / UPI paid out / other: the bank account
}

type Line = { acct: string; dr?: string; cr?: string; partyKind?: string; partyId?: string; mode?: string; fuelTypeId?: string; litres?: string; vehicle?: string };

const acctIds = new Map<string, string>();
async function acct(c: ClientBase, code: string): Promise<string> {
  const hit = acctIds.get(code);
  if (hit) return hit;
  const r = await c.query("SELECT id FROM accounts WHERE code = $1", [code]);
  if (!r.rowCount) throw new Error(`account ${code} missing`);
  acctIds.set(code, r.rows[0].id);
  return r.rows[0].id;
}

/** Inserts one balanced journal entry. The database re-checks balance and posting rules at COMMIT. */
export async function postJournal(
  c: ClientBase,
  j: { siteId: string; date: string; sourceType: string; sourceId?: string | null; narration: string; createdBy: string; approvedBy?: string | null; reverses?: string | null; lines: Line[] },
): Promise<string> {
  const e = await c.query(
    `INSERT INTO journal_entries (site_id, business_date, source_type, source_id, narration, created_by, approved_by, reverses_entry_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [j.siteId, j.date, j.sourceType, j.sourceId ?? null, j.narration.slice(0, 300), j.createdBy, j.approvedBy ?? null, j.reverses ?? null],
  );
  const id = e.rows[0].id as string;
  let n = 0;
  for (const l of j.lines) {
    await c.query(
      `INSERT INTO journal_lines (entry_id, line_no, account_id, party_kind, party_id, debit, credit, mode_code, fuel_type_id, litres, vehicle_no)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, ++n, await acct(c, l.acct), l.partyKind ?? null, l.partyId ?? null, l.dr ?? "0", l.cr ?? "0", l.mode ?? null, l.fuelTypeId ?? null, l.litres ?? null, l.vehicle ?? null],
    );
  }
  return id;
}

async function siteId(c: ClientBase): Promise<string> {
  const r = await c.query("SELECT id FROM sites WHERE active ORDER BY created_at LIMIT 1");
  if (!r.rowCount) throw new AppError("NO_SITE", 409, "The owner must set up the pump first.", "मालिक पहले पंप सेटअप करें।");
  return r.rows[0].id;
}

/**
 * Which business days an entry may go to right now. Normally only the day in progress. Between the
 * 8 AM cut-over and the end of the closing window (11 AM) the previous day is still offered, unless it
 * was already submitted or locked.
 */
export async function entryDates(c: ClientBase): Promise<{ today: string; yesterday: string | null }> {
  const s = await siteId(c);
  const r = await c.query(
    `SELECT cur.d::text AS today, rb.d::text AS rd,
            (SELECT status FROM business_days WHERE site_id = $1 AND business_date = rb.d) AS rd_status
       FROM (SELECT CASE WHEN (now() AT TIME ZONE si.timezone)::time >= si.day_cutover
                         THEN (now() AT TIME ZONE si.timezone)::date ELSE (now() AT TIME ZONE si.timezone)::date - 1 END AS d
               FROM sites si WHERE si.id = $1) cur,
            LATERAL (SELECT reading_business_date($1, now()) AS d) rb`,
    [s],
  );
  const x = r.rows[0];
  const yesterday = x.rd < x.today && (x.rd_status == null || x.rd_status === "OPEN") ? x.rd : null;
  return { today: x.today, yesterday };
}

async function dayStatus(c: ClientBase, site: string, date: string): Promise<string> {
  return (await c.query("SELECT lock_business_day_for_posting($1, $2) AS s", [site, date])).rows[0].s;
}

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------
export async function findOrCreateParty(
  c: ClientBase,
  userId: string,
  kind: "CUSTOMER" | "SUPPLIER" | "LENDER" | "EMPLOYEE",
  p: { id?: string | null; name?: string | null; phone?: string | null },
): Promise<string> {
  if (p.id) {
    const r = await c.query("SELECT id FROM parties WHERE id = $1 AND kind = $2 AND active", [p.id, kind]);
    if (!r.rowCount) throw Errors.badInput("Choose the person again from the list.");
    return p.id;
  }
  const name = String(p.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2) throw Errors.badInput("Enter the name.");
  const phone = p.phone ? String(p.phone).replace(/\D/g, "").slice(-10) : null;
  if (phone && phone.length !== 10) throw Errors.badInput("Phone number must have 10 digits.");
  if (phone) {
    const same = await c.query("SELECT name FROM parties WHERE kind = $1 AND phone = $2", [kind, phone]);
    if (same.rowCount)
      throw new AppError("DUPLICATE_PARTY", 409, `This phone number already belongs to "${same.rows[0].name}". Choose them from the list.`, "यह नंबर पहले से है। सूची से चुनें।");
  } else {
    const same = await c.query("SELECT id FROM parties WHERE kind = $1 AND active AND lower(name) = lower($2)", [kind, name]);
    if (same.rowCount === 1 && (kind === "SUPPLIER" || kind === "LENDER")) return same.rows[0].id; // "HPCL" every day = same supplier
    if (same.rowCount)
      throw new AppError("DUPLICATE_PARTY", 409, `"${name}" already exists. Choose them from the list, or add a phone number if this is a different person.`, "यह नाम पहले से है। सूची से चुनें।");
  }
  const r = await c.query("INSERT INTO parties (kind, name, phone, created_by) VALUES ($1,$2,$3,$4) RETURNING id", [kind, name, phone, userId]);
  return r.rows[0].id;
}

export async function searchParties(c: ClientBase, kind: string, q: string) {
  const r = await c.query(
    `SELECT p.id, p.name, p.phone,
            COALESCE((SELECT SUM(l.debit - l.credit) FROM journal_lines l WHERE l.party_id = p.id), 0)::text AS balance
       FROM parties p WHERE p.kind = $1 AND p.active AND ($2 = '' OR p.name ILIKE '%' || $2 || '%' OR p.phone LIKE $2 || '%')
      ORDER BY lower(p.name) LIMIT 30`,
    [kind, q.trim()],
  );
  return r.rows as Array<{ id: string; name: string; phone: string | null; balance: string }>;
}

export async function expenseAccounts(c: ClientBase) {
  const r = await c.query("SELECT code, name_en, name_hi FROM accounts WHERE subtype = 'OPEX' AND active AND code NOT IN ('6900','6960') ORDER BY sort_order");
  return r.rows as Array<{ code: string; name_en: string; name_hi: string }>;
}

// ---------------------------------------------------------------------------
// Create an entry (and its journal) in one transaction
// ---------------------------------------------------------------------------
export type EntryInput = {
  kind: EntryKind;
  businessDate?: string | null;
  party?: { id?: string | null; name?: string | null; phone?: string | null } | null;
  expenseCode?: string | null;
  mode?: string | null;
  amount: string;
  vehicleNo?: string | null;
  slipNo?: string | null;
  fuelCode?: string | null;
  litres?: string | null;
  description?: string | null;
};

export async function createEntry(
  c: ClientBase,
  user: { id: string; role: string; permissions: string[] },
  input: EntryInput,
  idempotencyKey: string,
): Promise<{ entryId: string; entryNo: string; businessDate: string; amount: string; kind: EntryKind }> {
  const k = ENTRY_KINDS[input.kind];
  if (!k) throw Errors.badInput("Unknown entry type.");
  if (!user.permissions.includes(k.perm) || (k.ownerOnly && user.role !== "OWNER")) throw Errors.forbidden();

  const site = await siteId(c);
  const dates = await entryDates(c);
  const date = input.businessDate ?? dates.today;
  if (date !== dates.today && date !== dates.yesterday)
    throw new AppError("BAD_DAY", 409, "Entries can only go to today's business day.", "प्रविष्टि केवल आज के दिन में।");
  if ((await dayStatus(c, site, date)) !== "OPEN")
    throw new AppError("DAY_CLOSED", 409, "This day's cash is already counted / locked. Ask the owner.", "इस दिन का हिसाब बंद हो चुका है।");

  let amount: string;
  try {
    amount = parseAmount(input.amount);
  } catch {
    throw Errors.badInput("Amount must be a number like 3050 or 550.50.");
  }

  const mode = input.kind === "CREDIT_SALE" ? "CUSTOMER_CREDIT" : String(input.mode ?? "CASH");
  if (input.kind !== "CREDIT_SALE") {
    const m = await c.query("SELECT allowed_on_receipt, allowed_on_payment FROM payment_modes WHERE code = $1 AND active", [mode]);
    if (!m.rowCount || !(k.dir === "IN" ? m.rows[0].allowed_on_receipt : m.rows[0].allowed_on_payment))
      throw Errors.badInput("Choose how the money was paid (cash, UPI, ...).");
    if (input.kind === "BANK_DEPOSIT" && mode !== "CASH") throw Errors.badInput("A bank deposit is cash taken to the bank.");
  }

  const partyId = k.party ? await findOrCreateParty(c, user.id, k.party, input.party ?? {}) : null;
  let fuelTypeId: string | null = null;
  if (input.fuelCode) {
    const f = await c.query("SELECT id FROM fuel_types WHERE code = $1", [input.fuelCode]);
    fuelTypeId = f.rows[0]?.id ?? null;
  }
  let litres: string | null = null;
  if (input.litres) {
    if (!/^\d{1,6}(\.\d{1,3})?$/.test(input.litres.trim())) throw Errors.badInput("Litres must be like 45.5");
    litres = new D(input.litres.trim()).toFixed(3);
  }
  let expenseAcct: string | null = null;
  if (input.kind === "EXPENSE") {
    const e = await c.query("SELECT id, code FROM accounts WHERE code = $1 AND subtype = 'OPEX' AND active", [input.expenseCode ?? ""]);
    if (!e.rowCount) throw Errors.badInput("Choose the expense type.");
    expenseAcct = e.rows[0].code;
  }

  const entryId = randomUUID();
  const vehicle = input.vehicleNo ? input.vehicleNo.toUpperCase().replace(/\s+/g, "").slice(0, 15) : null;
  const P = (kind: string) => ({ partyKind: kind, partyId: partyId! });
  const money = modeAccount(mode, k.dir === "OUT" ? "OUT" : "IN");
  const lines: Line[] = (() => {
    switch (input.kind) {
      case "CREDIT_SALE":
        return [
          { acct: "1400", dr: amount, ...P("CUSTOMER"), fuelTypeId: fuelTypeId ?? undefined, litres: litres ?? undefined, vehicle: vehicle ?? undefined, mode },
          { acct: "1900", cr: amount, mode },
        ];
      case "CUSTOMER_REPAYMENT":
        return [{ acct: money, dr: amount, mode }, { acct: "1400", cr: amount, ...P("CUSTOMER") }];
      case "LUBE_SALE":
        return [{ acct: money, dr: amount, mode }, { acct: "4200", cr: amount }];
      case "OTHER_INCOME":
        return [{ acct: money, dr: amount, mode }, { acct: "4300", cr: amount }];
      case "LOAN_RECEIVED":
        return [{ acct: money, dr: amount, mode }, { acct: "2200", cr: amount, ...P("LENDER") }];
      case "OWNER_CAPITAL":
        return [{ acct: money, dr: amount, mode }, { acct: "3200", cr: amount }];
      case "EXPENSE":
        return [{ acct: expenseAcct!, dr: amount }, { acct: money, cr: amount, mode }];
      case "SUPPLIER_PAYMENT":
        return [{ acct: "2100", dr: amount, ...P("SUPPLIER") }, { acct: money, cr: amount, mode }];
      case "BANK_DEPOSIT":
        return [{ acct: "1200", dr: amount }, { acct: "1100", cr: amount, mode }];
      case "SALARY":
        return [{ acct: "6100", dr: amount }, { acct: money, cr: amount, mode }];
      case "STAFF_ADVANCE":
        return [{ acct: "1700", dr: amount, ...P("EMPLOYEE") }, { acct: money, cr: amount, mode }];
      case "OWNER_DRAWING":
        return [{ acct: "3200", dr: amount }, { acct: money, cr: amount, mode }];
      case "LOAN_REPAYMENT":
        return [{ acct: "2200", dr: amount, ...P("LENDER") }, { acct: money, cr: amount, mode }];
    }
  })();

  const narration = [k.en, input.description, vehicle, input.slipNo].filter(Boolean).join(" · ");
  const journalId = await postJournal(c, { siteId: site, date, sourceType: SOURCE[input.kind], sourceId: entryId, narration, createdBy: user.id, lines });
  const r = await c.query(
    `INSERT INTO money_entries (id, site_id, business_date, kind, party_id, expense_account_id, mode_code, amount, vehicle_no, slip_no,
                                fuel_type_id, litres, description, entered_by, journal_entry_id, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,(SELECT id FROM accounts WHERE code = $6),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING entry_no::text`,
    [entryId, site, date, input.kind, partyId, expenseAcct, mode, amount, vehicle, input.slipNo?.trim().slice(0, 20) || null, fuelTypeId, litres,
     input.description?.trim().slice(0, 200) || null, user.id, journalId, idempotencyKey],
  );
  await c.query("SELECT pg_notify('pump_events', $1)", [JSON.stringify({ type: "entry", date })]);
  return { entryId, entryNo: r.rows[0].entry_no, businessDate: date, amount, kind: input.kind };
}

/** Owner cancels a wrong entry: exact reversal journal + reversal record. The original stays visible. */
export async function reverseEntry(c: ClientBase, owner: { id: string; role: string }, input: { entryId: string; reason: string }): Promise<void> {
  if (owner.role !== "OWNER") throw Errors.forbidden();
  if (String(input.reason ?? "").trim().length < 5) throw Errors.badInput("Write the reason (at least 5 letters).");
  // Facts cannot be row-locked (the app has no UPDATE right on them); serialise per entry instead.
  // The UNIQUE(money_entry_id) on reversals is the final guard against a double cancel.
  await c.query("SELECT pg_advisory_xact_lock(hashtext('reverse:' || $1))", [input.entryId]);
  const m = await c.query("SELECT * FROM money_entries WHERE id = $1", [input.entryId]);
  if (!m.rowCount) throw Errors.badInput("Entry not found.");
  if ((await c.query("SELECT 1 FROM money_entry_reversals WHERE money_entry_id = $1", [input.entryId])).rowCount)
    throw new AppError("ALREADY_CANCELLED", 409, "This entry is already cancelled.", "यह प्रविष्टि पहले ही रद्द है।");
  const e = m.rows[0];
  const status = await dayStatus(c, e.site_id, e.business_date);
  if (status === "SUBMITTED")
    throw new AppError("DAY_SUBMITTED", 409, "Send the day back for recount first, then cancel.", "पहले दिन को वापस खोलें।");
  if (status === "LOCKED")
    throw new AppError("DAY_LOCKED", 409, "This day is locked. Corrections to locked days come in a later update.", "यह दिन बंद है।");
  const orig = await c.query(
    `SELECT a.code, l.debit::text, l.credit::text, l.party_kind, l.party_id, l.mode_code FROM journal_lines l JOIN accounts a ON a.id = l.account_id
      WHERE l.entry_id = $1 ORDER BY l.line_no`,
    [e.journal_entry_id],
  );
  const lines: Line[] = orig.rows.map((l) => ({
    acct: l.code,
    dr: l.credit !== "0.00" ? l.credit : undefined,
    cr: l.debit !== "0.00" ? l.debit : undefined,
    partyKind: l.party_kind ?? undefined,
    partyId: l.party_id ?? undefined,
    mode: l.mode_code ?? undefined,
  }));
  const jid = await postJournal(c, {
    siteId: e.site_id,
    date: e.business_date,
    sourceType: "REVERSAL",
    sourceId: e.id,
    narration: `Cancelled entry #${e.entry_no}: ${input.reason.trim()}`,
    createdBy: owner.id,
    approvedBy: owner.id,
    reverses: e.journal_entry_id,
    lines,
  });
  await c.query("INSERT INTO money_entry_reversals (money_entry_id, reason, reversed_by, journal_entry_id) VALUES ($1,$2,$3,$4)", [
    e.id,
    input.reason.trim(),
    owner.id,
    jid,
  ]);
}

// ---------------------------------------------------------------------------
// The day's balance, in the register's order
// ---------------------------------------------------------------------------
export type DayBalance = Awaited<ReturnType<typeof getDayBalance>>;

export async function getDayBalance(c: ClientBase, date: string) {
  const site = await siteId(c);
  const status = (await c.query("SELECT status FROM business_days WHERE site_id = $1 AND business_date = $2", [site, date])).rows[0]?.status ?? "OPEN";

  const seg = await c.query(
    `SELECT n.id, n.label, st.name AS station, f.code AS fuel, s.sales_value::text AS value, s.customer_litres::text AS litres, s.confirmed, s.rate::text AS rate,
            (s.end_id IS NOT NULL) AS has_reading
       FROM nozzles n JOIN stations st ON st.id = n.station_id JOIN fuel_types f ON f.id = n.fuel_type_id
       LEFT JOIN v_meter_segments s ON s.nozzle_id = n.id AND s.business_date = $1 AND s.end_type = 'DAY_END'
      WHERE n.active AND st.active ORDER BY st.sort_order, n.sort_order`,
    [date],
  );
  const missingReadings = seg.rows.filter((r) => !r.has_reading).map((r) => `${r.station} ${r.label}`);
  const missingRates = [...new Set(seg.rows.filter((r) => r.has_reading && r.rate == null).map((r) => r.fuel))];
  const fuel: Record<string, { confirmed: Dec; provisional: Dec; litres: Dec }> = {};
  for (const r of seg.rows.filter((x) => x.has_reading && x.value != null)) {
    const f = (fuel[r.fuel] ??= { confirmed: new D(0), provisional: new D(0), litres: new D(0) });
    f.litres = f.litres.plus(r.litres);
    if (r.confirmed) f.confirmed = f.confirmed.plus(r.value);
    else f.provisional = f.provisional.plus(r.value);
  }
  const salesTotal = Object.values(fuel).reduce((a, f) => a.plus(f.confirmed).plus(f.provisional), new D(0));
  const provisionalTotal = Object.values(fuel).reduce((a, f) => a.plus(f.provisional), new D(0));
  const openFlags = (await c.query("SELECT count(*)::int n FROM v_open_meter_flags WHERE business_date = $1", [date])).rows[0].n as number;

  const entries = (
    await c.query(
      `SELECT m.id, m.entry_no::text, m.kind, m.mode_code, m.amount::text, m.vehicle_no, m.slip_no, m.description, m.entered_at,
              p.name AS party, a.name_en AS expense_name, u.name AS entered_by_name,
              r.reason AS cancelled_reason
         FROM money_entries m LEFT JOIN parties p ON p.id = m.party_id LEFT JOIN accounts a ON a.id = m.expense_account_id
         JOIN users u ON u.id = m.entered_by LEFT JOIN money_entry_reversals r ON r.money_entry_id = m.id
        WHERE m.site_id = $1 AND m.business_date = $2 ORDER BY m.entry_no`,
      [site, date],
    )
  ).rows as Array<{ id: string; entry_no: string; kind: EntryKind; mode_code: string; amount: string; vehicle_no: string | null; slip_no: string | null;
    description: string | null; entered_at: Date; party: string | null; expense_name: string | null; entered_by_name: string; cancelled_reason: string | null }>;

  const live = entries.filter((e) => !e.cancelled_reason);
  const sum = (pred: (e: (typeof live)[number]) => boolean) => live.filter(pred).reduce((a, e) => a.plus(e.amount), new D(0));
  const udhariGiven = sum((e) => e.kind === "CREDIT_SALE");
  const udhariReceived = sum((e) => e.kind === "CUSTOMER_REPAYMENT");
  const udhariReceivedCash = sum((e) => e.kind === "CUSTOMER_REPAYMENT" && e.mode_code === "CASH");
  const otherInCash = sum((e) => ENTRY_KINDS[e.kind].dir === "IN" && e.kind !== "CUSTOMER_REPAYMENT" && e.mode_code === "CASH");
  const otherIn = sum((e) => ENTRY_KINDS[e.kind].dir === "IN" && e.kind !== "CUSTOMER_REPAYMENT");
  const paymentsCash = sum((e) => ENTRY_KINDS[e.kind].dir === "OUT" && e.mode_code === "CASH");
  const paymentsAll = sum((e) => ENTRY_KINDS[e.kind].dir === "OUT");
  const nonCashIn = udhariReceived.minus(udhariReceivedCash).plus(otherIn.minus(otherInCash));

  const cashSales = salesTotal.minus(udhariGiven);
  const expectedCash = cashSales.plus(udhariReceivedCash).plus(otherInCash).minus(paymentsCash);
  const count = (
    await c.query(
      `SELECT cc.counted::text, cc.at, u.name AS by FROM cash_counts cc JOIN users u ON u.id = cc.counted_by
        WHERE cc.site_id = $1 AND cc.business_date = $2 ORDER BY cc.at DESC LIMIT 1`,
      [site, date],
    )
  ).rows[0] as { counted: string; at: Date; by: string } | undefined;
  const difference = count ? new D(count.counted).minus(expectedCash) : null;
  const tolerance = new D(
    (await c.query("SELECT value #>> '{}' AS v FROM settings WHERE key = 'cash_rounding_tolerance'")).rows[0]?.v ?? "10",
  );

  const problems: string[] = [];
  if (missingReadings.length) problems.push(`Readings missing: ${missingReadings.join(", ")}`);
  if (missingRates.length) problems.push(`Rate not set for: ${missingRates.join(", ")}`);
  if (openFlags) problems.push(`${openFlags} reading(s) waiting for owner review`);
  if (cashSales.lt(0)) problems.push("Udhari given is more than the fuel sales. Check the udhari entries.");
  if (!count) problems.push("Cash not counted yet");

  return {
    date,
    status: status as "OPEN" | "SUBMITTED" | "LOCKED",
    sales: {
      byFuel: Object.fromEntries(
        Object.entries(fuel).map(([k, v]) => [k, { litres: v.litres.toFixed(3), value: v.confirmed.plus(v.provisional).toFixed(2), provisional: v.provisional.toFixed(2) }]),
      ),
      total: salesTotal.toFixed(2),
      provisional: provisionalTotal.toFixed(2),
      missingReadings,
      missingRates,
      openFlags,
    },
    udhariGiven: udhariGiven.toFixed(2),
    udhariReceived: udhariReceived.toFixed(2),
    udhariReceivedCash: udhariReceivedCash.toFixed(2),
    otherIn: otherIn.toFixed(2),
    otherInCash: otherInCash.toFixed(2),
    paymentsAll: paymentsAll.toFixed(2),
    paymentsCash: paymentsCash.toFixed(2),
    nonCashIn: nonCashIn.toFixed(2),
    paymentsNonCash: paymentsAll.minus(paymentsCash).toFixed(2),
    cashSales: cashSales.toFixed(2),
    expectedCash: expectedCash.toFixed(2),
    counted: count?.counted ?? null,
    countedBy: count?.by ?? null,
    difference: difference?.toFixed(2) ?? null,
    withinTolerance: difference ? difference.abs().lte(tolerance) : null,
    problems,
    entries,
    _site: site,
    _fuel: fuel,
  };
}

// ---------------------------------------------------------------------------
// Cash count + submit (staff with cash.count), send back (owner), lock (owner)
// ---------------------------------------------------------------------------
export async function countCash(c: ClientBase, user: { id: string }, input: { date: string; counted: string }, idempotencyKey: string) {
  let counted: string;
  try {
    counted = /^0+(\.0+)?$/.test(String(input.counted).trim()) ? "0.00" : parseAmount(input.counted);
  } catch {
    throw Errors.badInput("Counted cash must be a number like 859314.");
  }
  const dates = await entryDates(c);
  // Today, or any earlier day not yet ended (e.g. someone forgot to end yesterday before 11 AM).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date > dates.today)
    throw new AppError("BAD_DAY", 409, "You can count cash only for today or an earlier day.", "केवल आज या पिछले दिन की गिनती।");
  const bal = await getDayBalance(c, input.date);
  await c.query(
    "INSERT INTO cash_counts (site_id, business_date, counted, expected_at_count, counted_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6)",
    [bal._site, input.date, counted, bal.expectedCash, user.id, idempotencyKey],
  );
  await c.query(
    "UPDATE business_days SET status = 'SUBMITTED', submitted_by = $3, submitted_at = now() WHERE site_id = $1 AND business_date = $2 AND status = 'OPEN'",
    [bal._site, input.date, user.id],
  );
  const after = await getDayBalance(c, input.date);
  return { expected: after.expectedCash, counted, difference: after.difference };
}

export async function reopenDay(c: ClientBase, owner: { role: string }, date: string) {
  if (owner.role !== "OWNER") throw Errors.forbidden();
  const site = await siteId(c);
  const r = await c.query("UPDATE business_days SET status = 'OPEN' WHERE site_id = $1 AND business_date = $2 AND status = 'SUBMITTED'", [site, date]);
  if (!r.rowCount) throw Errors.badInput("Only a submitted (not locked) day can be sent back.");
}

export async function lockDay(
  c: ClientBase,
  owner: { id: string; role: string; permissions: string[] },
  input: { date: string; overrideReason?: string | null },
) {
  // Anyone with closing.lock may end a clean day; problems need closing.override (owner) + reason.
  if (!owner.permissions.includes("closing.lock")) throw Errors.forbidden();
  const site = await siteId(c);
  const day = await c.query("SELECT status FROM business_days WHERE site_id = $1 AND business_date = $2 FOR UPDATE", [site, input.date]);
  if (day.rows[0]?.status !== "SUBMITTED")
    throw new AppError("NOT_SUBMITTED", 409, "Count the cash and submit the day before locking.", "पहले नकद गिनकर जमा करें।");

  const b = await getDayBalance(c, input.date);
  // These can never be overridden: money cannot be valued or would go negative.
  if (b.sales.missingRates.length) throw new AppError("RATE_MISSING", 409, `Set the rate for ${b.sales.missingRates.join(", ")} first.`, "पहले रेट डालें।");
  if (new D(b.cashSales).lt(0)) throw new AppError("CREDIT_EXCEEDS_SALES", 409, "Udhari given is more than fuel sales. Check the entries.", "उधारी बिक्री से ज़्यादा है।");
  const soft = b.problems.filter((p) => !p.startsWith("Cash not counted"));
  const override = String(input.overrideReason ?? "").trim();
  if (soft.length && !owner.permissions.includes("closing.override"))
    throw new AppError("CLOSING_GUARD", 409, `Cannot end the day yet: ${soft.join("; ")}. Fix these, or ask the owner.`, "पहले ये ठीक करें या मालिक से कहें।");
  if (soft.length && override.length < 5)
    throw new AppError("CLOSING_GUARD", 409, `Cannot end the day yet: ${soft.join("; ")}. Fix these, or end anyway with a written reason.`, "पहले ये ठीक करें या कारण लिखकर बंद करें।");

  const fuelIds = Object.fromEntries((await c.query("SELECT code, id FROM fuel_types")).rows.map((r) => [r.code, r.id]));
  const REV: Record<string, string> = { PETROL: "4100", DIESEL: "4110" };
  const j = (sourceType: string, narration: string, lines: Line[]) =>
    postJournal(c, { siteId: site, date: input.date, sourceType, narration, createdBy: owner.id, approvedBy: owner.id, lines });

  // 1. Fuel revenue from meter readings: the ONLY place fuel revenue is created.
  const revLines: Line[] = [];
  for (const [fuel, v] of Object.entries(b._fuel)) {
    if (v.confirmed.gt(0)) revLines.push({ acct: REV[fuel], cr: v.confirmed.toFixed(2), fuelTypeId: fuelIds[fuel], litres: v.litres.toFixed(3) });
    if (v.provisional.gt(0)) revLines.push({ acct: "4190", cr: v.provisional.toFixed(2), fuelTypeId: fuelIds[fuel] });
  }
  if (new D(b.sales.total).gt(0)) await j("DAY_SALES_POST", `Fuel sales ${input.date}`, [{ acct: "1900", dr: b.sales.total }, ...revLines]);
  // 2. How the sales were settled: udhari already credited 1900 during the day; the rest came as cash.
  if (new D(b.cashSales).gt(0)) await j("SALES_SETTLEMENT", `Cash fuel sales ${input.date}`, [{ acct: "1100", dr: b.cashSales, mode: "CASH" }, { acct: "1900", cr: b.cashSales }]);
  // 3. Cash short / excess goes to suspense, never to expenses.
  const diff = new D(b.difference ?? "0");
  if (!diff.isZero())
    await j(
      "CASH_COUNT_DIFFERENCE",
      `Cash ${diff.lt(0) ? "short" : "excess"} ${input.date}`,
      diff.lt(0) ? [{ acct: "1600", dr: diff.abs().toFixed(2) }, { acct: "1100", cr: diff.abs().toFixed(2) }] : [{ acct: "1100", dr: diff.toFixed(2) }, { acct: "1600", cr: diff.toFixed(2) }],
    );
  // 4. Counted cash handed to the owner (the register starts each day without opening cash).
  const handover = (await c.query("SELECT value FROM settings WHERE key = 'cash_handover_at_close'")).rows[0]?.value !== false;
  if (handover && new D(b.counted ?? "0").gt(0))
    await j("INTERNAL_TRANSFER", `Day's cash handed to owner ${input.date}`, [{ acct: "1150", dr: b.counted! }, { acct: "1100", cr: b.counted! }]);

  // Fuel sales control must be exactly zero for the day (INV-13).
  const ctl = await c.query(
    `SELECT COALESCE(SUM(l.debit - l.credit),0)::numeric(14,2)::text AS bal FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      JOIN accounts a ON a.id = l.account_id WHERE a.code = '1900' AND e.site_id = $1 AND e.business_date = $2`,
    [site, input.date],
  );
  if (ctl.rows[0].bal !== "0.00") throw new Error(`Fuel sales control not zero after lock: ${ctl.rows[0].bal}`);

  const figures = {
    date: input.date,
    sales: b.sales,
    udhariGiven: b.udhariGiven,
    udhariReceived: b.udhariReceived,
    otherIn: b.otherIn,
    payments: b.paymentsAll,
    cashSales: b.cashSales,
    expectedCash: b.expectedCash,
    counted: b.counted,
    difference: b.difference,
    entries: b.entries.filter((e) => !e.cancelled_reason).map((e) => [e.entry_no, e.kind, e.amount]),
    override: soft.length ? { problems: soft, reason: override } : null,
    heads: (await c.query("SELECT nozzle_id, head FROM v_meter_chain_heads ORDER BY nozzle_id")).rows,
  };
  const code = createHash("sha256").update(JSON.stringify(figures)).digest("hex").slice(0, 8).toUpperCase();
  await c.query("INSERT INTO day_snapshots (site_id, business_date, kind, figures, integrity_code, created_by) VALUES ($1,$2,'LOCK',$3,$4,$5)", [
    site,
    input.date,
    JSON.stringify(figures),
    code,
    owner.id,
  ]);
  await c.query(
    "UPDATE business_days SET status = 'LOCKED', locked_by = $3, locked_at = now(), override_reason = $4 WHERE site_id = $1 AND business_date = $2",
    [site, input.date, owner.id, soft.length ? override : null],
  );
  return { integrityCode: code };
}

/**
 * "End day" in one step: record the counted cash, submit and lock, all in one transaction.
 * If the lock is refused (missing readings, rate not set ...) nothing is saved and the reasons come back.
 */
export async function endDay(
  c: ClientBase,
  user: { id: string; role: string; permissions: string[] },
  input: { date: string; counted: string; overrideReason?: string | null },
  idempotencyKey: string,
) {
  if (!user.permissions.includes("cash.count") && user.role !== "OWNER") throw Errors.forbidden();
  const site = await siteId(c);
  const status = await dayStatus(c, site, input.date);
  if (status === "LOCKED") throw new AppError("ALREADY_ENDED", 409, "This day is already ended.", "यह दिन पहले ही बंद है।");
  const can = (await c.query("SELECT can_end_business_day($1, $2) AS ok", [site, input.date])).rows[0].ok;
  if (!can)
    throw new AppError(
      "TOO_EARLY",
      409,
      `${new Date(`${input.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} is still running until the next day's 8 AM closing. End it then, after the nozzle readings.`,
      "यह दिन कल सुबह 8 बजे की रीडिंग के बाद बंद होगा।",
    );
  if (status === "SUBMITTED") await reopenDay(c, { role: "OWNER" }, input.date); // a recount inside the same End day
  const counted = await countCash(c, user, { date: input.date, counted: input.counted }, idempotencyKey);
  const lock = await lockDay(c, user, { date: input.date, overrideReason: input.overrideReason });
  return { ...counted, integrityCode: lock.integrityCode };
}

/** All customers with their udhari position (for the register's drop-down and the customers page). */
export async function customerList(c: ClientBase) {
  const r = await c.query(
    `SELECT p.id, p.name, p.phone,
            COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.source_type = 'OPENING_BALANCE'), 0)::numeric(14,2)::text AS opening,
            COALESCE(SUM(l.debit) FILTER (WHERE e.source_type = 'CREDIT_SALE'), 0)::numeric(14,2)::text AS given,
            COALESCE(SUM(l.credit) FILTER (WHERE e.source_type = 'CUSTOMER_REPAYMENT'), 0)::numeric(14,2)::text AS received,
            COALESCE(SUM(l.debit - l.credit), 0)::numeric(14,2)::text AS balance,
            MAX(e.business_date)::text AS last_date,
            (SELECT string_agg(DISTINCT m.vehicle_no, ', ') FROM money_entries m WHERE m.party_id = p.id AND m.vehicle_no IS NOT NULL) AS vehicles
       FROM parties p
       LEFT JOIN journal_lines l ON l.party_id = p.id
       LEFT JOIN journal_entries e ON e.id = l.entry_id
      WHERE p.kind = 'CUSTOMER' AND p.active
      GROUP BY p.id ORDER BY lower(p.name)`,
  );
  return r.rows as Array<{ id: string; name: string; phone: string | null; opening: string; given: string; received: string; balance: string; last_date: string | null; vehicles: string | null }>;
}

// ---------------------------------------------------------------------------
// Customer statement (date, description, debit, credit, running balance)
// ---------------------------------------------------------------------------
export async function partyStatement(c: ClientBase, partyId: string) {
  const p = await c.query("SELECT id, kind, name, phone, address FROM parties WHERE id = $1", [partyId]);
  if (!p.rowCount) throw Errors.badInput("Not found.");
  const rows = await c.query(
    `SELECT e.business_date::text AS date, e.entry_no::text AS ref, e.source_type, e.narration, l.debit::text, l.credit::text, l.vehicle_no
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.party_id = $1 ORDER BY e.business_date, e.entry_no`,
    [partyId],
  );
  let bal = new D(0);
  const lines = rows.rows.map((r) => {
    bal = bal.plus(r.debit).minus(r.credit);
    return { ...r, balance: bal.toFixed(2) };
  });
  return { party: p.rows[0], lines, balance: bal.toFixed(2) };
}
