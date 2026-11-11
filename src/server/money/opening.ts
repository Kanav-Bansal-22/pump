import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import type { ClientBase } from "pg";
import { AppError, Errors } from "../errors";
import { D, formatINR } from "../money";
import { postJournal } from "./service";

/** Header names we accept (lower-case, spaces/dots removed). */
const HEADERS: Record<"name" | "phone" | "address" | "amount" | "remarks", string[]> = {
  name: ["name", "customer", "customername", "naam", "party", "partyname", "नाम"],
  phone: ["phone", "mobile", "mobileno", "phoneno", "contact", "mob", "फोन", "मोबाइल"],
  address: ["address", "pata", "पता"],
  amount: ["amount", "opening", "openingbalance", "balance", "outstanding", "baki", "baaki", "due", "udhari", "बाकी", "रकम"],
  remarks: ["remarks", "remark", "note", "notes", "टिप्पणी"],
};
const norm = (s: string) => s.toLowerCase().replace(/[\s._\-()₹/]/g, "");
export const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type ParsedRow = { rowNo: number; raw: Record<string, string>; name: string; phone: string; address: string; amount: string; remarks: string };

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("result" in v && v.result != null) return String(v.result);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/** Reads an .xlsx or .csv file into rows, finding the header row by its column names. */
export async function parseFile(fileName: string, data: Buffer): Promise<ParsedRow[]> {
  let grid: string[][];
  if (/\.xlsx$/i.test(fileName)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw Errors.badInput("The Excel file has no sheet.");
    grid = [];
    ws.eachRow({ includeEmpty: true }, (r, n) => {
      const vals = r.values as ExcelJS.CellValue[];
      grid[n - 1] = vals.slice(1).map(cellText);
    });
    grid = Array.from(grid, (r) => r ?? []);
  } else if (/\.csv$/i.test(fileName)) {
    grid = parseCsv(data.toString("utf8").replace(/^﻿/, ""));
  } else {
    throw Errors.badInput("Upload an Excel (.xlsx) or CSV (.csv) file.");
  }
  const headerIdx = grid.findIndex((r) => r.some((c) => HEADERS.name.includes(norm(c ?? ""))) && r.some((c) => HEADERS.amount.includes(norm(c ?? ""))));
  if (headerIdx < 0) throw Errors.badInput("Could not find the header row. Use the template: Name, Phone, Address, Amount, Remarks.");
  const header = grid[headerIdx].map((c) => norm(c ?? ""));
  const col = (k: keyof typeof HEADERS) => header.findIndex((h) => HEADERS[k].includes(h));
  const ci = { name: col("name"), phone: col("phone"), address: col("address"), amount: col("amount"), remarks: col("remarks") };
  const out: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const get = (k: keyof typeof ci) => (ci[k] >= 0 ? String(r[ci[k]] ?? "").trim() : "");
    if (r.every((c) => !String(c ?? "").trim())) continue; // skip blank lines
    const raw: Record<string, string> = {};
    grid[headerIdx].forEach((h, j) => (raw[String(h || `col${j + 1}`)] = String(r[j] ?? "")));
    out.push({ rowNo: i + 1, raw, name: get("name"), phone: get("phone"), address: get("address"), amount: get("amount"), remarks: get("remarks") });
  }
  if (out.length === 0) throw Errors.badInput("The file has no customer rows under the header.");
  if (out.length > 5000) throw Errors.badInput("Too many rows (max 5000).");
  return out;
}

/** "1,80,000", "₹ 3050.50", "-500", "500 Cr" (advance) -> signed 2-dp string, or null if unreadable. */
export function parseSignedAmount(raw: string): string | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  let neg = false;
  if (/\bcr\.?$/i.test(s)) {
    neg = true;
    s = s.replace(/\s*cr\.?$/i, "");
  } else s = s.replace(/\s*dr\.?$/i, "");
  s = s.replace(/[₹,\s]/g, "");
  if (s.startsWith("(") && s.endsWith(")")) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) return null;
  const d = new D(s);
  return (neg && !d.isZero() ? d.neg() : d).toFixed(2);
}

const cleanPhone = (p: string) => {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
};

// ---------------------------------------------------------------------------
// Single old balance (also used by the import)
// ---------------------------------------------------------------------------
export async function addOpeningBalance(
  c: ClientBase,
  user: { id: string },
  o: { siteId: string; partyId: string; amount: string; date: string; remarks?: string | null; importRowId?: string | null },
): Promise<string | null> {
  const amt = new D(o.amount);
  if (amt.isZero()) return null;
  if ((await c.query("SELECT 1 FROM opening_balances WHERE party_id = $1", [o.partyId])).rowCount)
    throw new AppError("HAS_OPENING", 409, "This customer already has an old balance. Cancel or correct it instead.", "इस ग्राहक का पुराना बकाया पहले से है।");
  const abs = amt.abs().toFixed(2);
  const lines = amt.gt(0)
    ? [{ acct: "1400", dr: abs, partyKind: "CUSTOMER", partyId: o.partyId }, { acct: "3100", cr: abs }]
    : [{ acct: "3100", dr: abs }, { acct: "1400", cr: abs, partyKind: "CUSTOMER", partyId: o.partyId }];
  const jid = await postJournal(c, {
    siteId: o.siteId,
    date: o.date,
    sourceType: "OPENING_BALANCE",
    sourceId: o.importRowId ?? null,
    narration: `Old register balance${o.remarks ? ` · ${o.remarks}` : ""}`,
    createdBy: user.id,
    lines,
  });
  await c.query(
    "INSERT INTO opening_balances (party_id, amount, opening_date, remarks, import_row_id, journal_entry_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [o.partyId, amt.toFixed(2), o.date, o.remarks ?? null, o.importRowId ?? null, jid, user.id],
  );
  return jid;
}

async function siteId(c: ClientBase): Promise<string> {
  const r = await c.query("SELECT id FROM sites WHERE active ORDER BY created_at LIMIT 1");
  if (!r.rowCount) throw new AppError("NO_SITE", 409, "Set up the pump first.", "पहले पंप सेटअप करें।");
  return r.rows[0].id;
}

// ---------------------------------------------------------------------------
// Preview: parse, validate, match. Nothing is posted yet.
// ---------------------------------------------------------------------------
export type PreviewRow = { rowNo: number; name: string; phone: string; amount: string | null; status: "NEW" | "MATCH_EXISTING" | "ERROR"; matchName?: string; error?: string };
export type Preview = { batchId: string; fileName: string; rows: PreviewRow[]; counts: { NEW: number; MATCH_EXISTING: number; ERROR: number }; total: string; owing: string; advance: string; openingDate: string };

export async function previewImport(
  c: ClientBase,
  user: { id: string },
  input: { fileName: string; fileBase64: string; openingDate: string },
): Promise<Preview> {
  const data = Buffer.from(input.fileBase64, "base64");
  if (data.length === 0 || data.length > 2 * 1024 * 1024) throw Errors.badInput("The file must be smaller than 2 MB.");
  const sha = createHash("sha256").update(data).digest("hex");
  const done = await c.query("SELECT confirmed_at FROM import_batches WHERE file_sha256 = $1 AND status = 'CONFIRMED'", [sha]);
  if (done.rowCount)
    throw new AppError("ALREADY_IMPORTED", 409, `This exact file was already imported on ${new Date(done.rows[0].confirmed_at).toLocaleDateString("en-IN")}.`, "यह फ़ाइल पहले ही इम्पोर्ट हो चुकी है।");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.openingDate)) throw Errors.badInput("Choose the date of the old balances.");

  const parsed = await parseFile(input.fileName, data);
  const existing = (
    await c.query(
      `SELECT p.id, p.name, p.phone, EXISTS (SELECT 1 FROM opening_balances o WHERE o.party_id = p.id) AS has_opening
         FROM parties p WHERE p.kind = 'CUSTOMER'`,
    )
  ).rows as Array<{ id: string; name: string; phone: string | null; has_opening: boolean }>;
  const byPhone = new Map(existing.filter((e) => e.phone).map((e) => [e.phone!, e]));
  const byName = new Map<string, typeof existing>();
  for (const e of existing) byName.set(normName(e.name), [...(byName.get(normName(e.name)) ?? []), e]);

  // duplicates inside the file (same phone, or same name when no phone)
  const seenPhone = new Map<string, number>();
  const seenName = new Map<string, number>();
  for (const r of parsed) {
    const ph = cleanPhone(r.phone);
    if (ph) seenPhone.set(ph, (seenPhone.get(ph) ?? 0) + 1);
    seenName.set(normName(r.name), (seenName.get(normName(r.name)) ?? 0) + 1);
  }

  const rows: PreviewRow[] = [];
  const records: Array<PreviewRow & { address: string; remarks: string; raw: Record<string, string>; matchId?: string; phoneClean: string }> = [];
  for (const r of parsed) {
    const phone = cleanPhone(r.phone);
    const amount = parseSignedAmount(r.amount);
    const base = { rowNo: r.rowNo, name: r.name.replace(/\s+/g, " ").trim(), phone, amount, address: r.address, remarks: r.remarks, raw: r.raw, phoneClean: phone };
    const err = (error: string) => records.push({ ...base, status: "ERROR", error });
    if (base.name.length < 2) err("Name is missing");
    else if (/^example/i.test(base.name)) err("This is the template's example row: delete it");
    else if (r.amount.trim() === "") err("Amount is missing (write 0 if nothing is due)");
    else if (amount == null) err(`Amount "${r.amount}" is not a number`);
    else if (phone && phone.length !== 10) err(`Phone "${r.phone}" must have 10 digits`);
    else if (phone && (seenPhone.get(phone) ?? 0) > 1) err("Same phone appears more than once in the file");
    else if (!phone && (seenName.get(normName(base.name)) ?? 0) > 1) err("Same name appears more than once in the file: add phone numbers to tell them apart");
    else {
      const m = phone ? byPhone.get(phone) : undefined;
      const sameName = byName.get(normName(base.name)) ?? [];
      const match = m ?? (sameName.length === 1 && !(phone && sameName[0].phone && sameName[0].phone !== phone) ? sameName[0] : undefined);
      if (!m && sameName.length > 1) err(`${sameName.length} customers in the app are called "${base.name}": add the phone number`);
      else if (match?.has_opening) err(`"${match.name}" already has an old balance in the app`);
      else if (match) records.push({ ...base, status: "MATCH_EXISTING", matchId: match.id, matchName: match.name });
      else records.push({ ...base, status: "NEW" });
    }
  }
  const ok = records.filter((r) => r.status !== "ERROR");
  const total = ok.reduce((a, r) => a.plus(r.amount!), new D(0));
  const owing = ok.filter((r) => new D(r.amount!).gt(0)).reduce((a, r) => a.plus(r.amount!), new D(0));
  const advance = ok.filter((r) => new D(r.amount!).lt(0)).reduce((a, r) => a.plus(r.amount!), new D(0));

  const b = await c.query(
    `INSERT INTO import_batches (kind, file_name, file_sha256, opening_date, row_count, file_total, created_by)
     VALUES ('CUSTOMER_OPENING', $1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.fileName.slice(0, 120), sha, input.openingDate, records.length, total.toFixed(2), user.id],
  );
  const batchId = b.rows[0].id as string;
  for (const r of records) {
    await c.query(
      `INSERT INTO import_rows (batch_id, row_no, raw, name, phone, address, amount, remarks, status, match_party_id, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [batchId, r.rowNo, JSON.stringify(r.raw), r.name || null, r.phoneClean || null, r.address || null, r.amount, r.remarks || null, r.status, r.matchId ?? null, r.error ?? null],
    );
    rows.push({ rowNo: r.rowNo, name: r.name, phone: r.phoneClean, amount: r.amount, status: r.status, matchName: r.matchName, error: r.error });
  }
  const counts = { NEW: 0, MATCH_EXISTING: 0, ERROR: 0 };
  for (const r of rows) counts[r.status]++;
  return { batchId, fileName: input.fileName, rows, counts, total: total.toFixed(2), owing: owing.toFixed(2), advance: advance.toFixed(2), openingDate: input.openingDate };
}

// ---------------------------------------------------------------------------
// Confirm: only when there are no problem rows and the old register's total matches.
// ---------------------------------------------------------------------------
export async function confirmImport(c: ClientBase, owner: { id: string }, input: { batchId: string; registerTotal: string }) {
  const b = await c.query("SELECT * FROM import_batches WHERE id = $1 FOR UPDATE", [input.batchId]);
  if (!b.rowCount) throw Errors.badInput("Import not found. Upload the file again.");
  const batch = b.rows[0];
  if (batch.status !== "PREVIEW") throw new AppError("NOT_PREVIEW", 409, "This import was already confirmed or cancelled.", "यह इम्पोर्ट पहले ही हो चुका है।");
  const done = await c.query("SELECT 1 FROM import_batches WHERE file_sha256 = $1 AND status = 'CONFIRMED'", [batch.file_sha256]);
  if (done.rowCount) throw new AppError("ALREADY_IMPORTED", 409, "This exact file was already imported.", "यह फ़ाइल पहले ही इम्पोर्ट हो चुकी है।");
  const errors = (await c.query("SELECT count(*)::int n FROM import_rows WHERE batch_id = $1 AND status = 'ERROR'", [batch.id])).rows[0].n;
  if (errors) throw new AppError("ROWS_WITH_PROBLEMS", 409, `${errors} row(s) have problems. Fix the file and upload it again.`, "फ़ाइल की गलतियाँ ठीक करें।");
  const typed = parseSignedAmount(input.registerTotal);
  if (typed == null) throw Errors.badInput("Type the total from the old register, e.g. 12,45,300.");
  if (!new D(typed).eq(batch.file_total)) {
    const diff = new D(batch.file_total).minus(typed);
    throw new AppError(
      "TOTAL_MISMATCH",
      409,
      `The file adds up to ${formatINR(batch.file_total)} but the register says ${formatINR(typed)}. The file is ${formatINR(diff.abs())} ${diff.lt(0) ? "less" : "more"}. Check the file against the register.`,
      "फ़ाइल का कुल रजिस्टर से अलग है।",
    );
  }
  const site = await siteId(c);
  const rows = (await c.query("SELECT * FROM import_rows WHERE batch_id = $1 ORDER BY row_no", [batch.id])).rows;
  let created = 0;
  let matched = 0;
  for (const r of rows) {
    let partyId = r.match_party_id as string | null;
    if (!partyId) {
      if (r.phone && (await c.query("SELECT 1 FROM parties WHERE kind = 'CUSTOMER' AND phone = $1", [r.phone])).rowCount)
        throw new AppError("CHANGED", 409, `A customer with phone ${r.phone} was added after the preview. Upload the file again.`, "फ़ाइल दोबारा अपलोड करें।");
      partyId = (
        await c.query("INSERT INTO parties (kind, name, phone, address, remarks, created_by) VALUES ('CUSTOMER',$1,$2,$3,$4,$5) RETURNING id", [
          r.name,
          r.phone,
          r.address,
          r.remarks,
          owner.id,
        ])
      ).rows[0].id;
      created++;
    } else matched++;
    const jid = await addOpeningBalance(c, owner, { siteId: site, partyId: partyId!, amount: r.amount, date: batch.opening_date, remarks: r.remarks, importRowId: r.id });
    if (jid) await c.query("INSERT INTO import_row_results (row_id, party_id, journal_entry_id) VALUES ($1,$2,$3)", [r.id, partyId, jid]);
  }
  await c.query("UPDATE import_batches SET status = 'CONFIRMED', register_total = $2, confirmed_by = $3, confirmed_at = now() WHERE id = $1", [
    batch.id,
    typed,
    owner.id,
  ]);
  return { created, matched, total: batch.file_total as string };
}

export async function cancelImport(c: ClientBase, batchId: string) {
  const r = await c.query("UPDATE import_batches SET status = 'CANCELLED' WHERE id = $1 AND status = 'PREVIEW'", [batchId]);
  if (!r.rowCount) throw Errors.badInput("Nothing to cancel.");
}

/** Excel template the owner fills from the old register. */
export async function templateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Old udhari");
  ws.columns = [
    { header: "Name", key: "name", width: 28 },
    { header: "Phone", key: "phone", width: 14 },
    { header: "Address", key: "address", width: 28 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "Remarks", key: "remarks", width: 30 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.addRow({ name: "EXAMPLE: delete this row", phone: "9800000000", address: "", amount: 0, remarks: "Amount: what they owe. Use minus (-500) for an advance." });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
