import type { ClientBase } from "pg";
import { AppError, Blocked, Errors } from "../errors";
import { D, round2, type Dec } from "../money";

/** Rules H1-H7 of addendum v1.1 (blocks) and F1-F6 (flags). */
export type FlagCode = "ZERO_THROUGHPUT" | "HIGH_VOLUME" | "LOW_VOLUME" | "IMPLAUSIBLE_RATE" | "MULTI_DAY_SEGMENT";

const FLAG_TEXT: Record<FlagCode, { en: string; hi: string }> = {
  ZERO_THROUGHPUT: { en: "No fuel sold since the last reading. Owner will confirm the nozzle was idle.", hi: "पिछली रीडिंग से कोई बिक्री नहीं।" },
  HIGH_VOLUME: { en: "Much more fuel than usual. Owner will check.", hi: "सामान्य से बहुत ज़्यादा ईंधन।" },
  LOW_VOLUME: { en: "Much less fuel than usual. Owner will check.", hi: "सामान्य से बहुत कम ईंधन।" },
  IMPLAUSIBLE_RATE: { en: "More litres than the nozzle can pump in that time. Owner will check.", hi: "इतने समय में इतना ईंधन संभव नहीं।" },
  MULTI_DAY_SEGMENT: { en: "Readings were missed on earlier days. Owner will split the litres by day.", hi: "पिछले दिनों की रीडिंग छूटी है।" },
};

export type Board = Array<{
  nozzleId: string;
  stationName: string;
  label: string;
  fuelCode: string;
  fuelShort: string;
  active: boolean;
  hasBaseline: boolean;
  last: { pointId: string; reading: string; at: string; byName: string; businessDate: string; type: string } | null;
  closingDate: string;
  doneForClosingDate: boolean;
  openFlags: number;
}>;

async function siteId(c: ClientBase): Promise<string> {
  const r = await c.query("SELECT id FROM sites WHERE active ORDER BY created_at LIMIT 1");
  if (!r.rowCount) throw new AppError("NO_SITE", 409, "The owner must set up the pump first.", "मालिक पहले पंप सेटअप करें।");
  return r.rows[0].id;
}

/** Business day in progress right now (e.g. after 08:00 = today). Used for rates. */
export async function currentBusinessDate(c: ClientBase): Promise<string> {
  const r = await c.query(
    `SELECT CASE WHEN (now() AT TIME ZONE s.timezone)::time >= s.day_cutover
                 THEN (now() AT TIME ZONE s.timezone)::date ELSE (now() AT TIME ZONE s.timezone)::date - 1 END::text AS d
       FROM sites s WHERE s.active ORDER BY s.created_at LIMIT 1`,
  );
  if (!r.rowCount) throw new AppError("NO_SITE", 409, "The owner must set up the pump first.", "मालिक पहले पंप सेटअप करें।");
  return r.rows[0].d;
}

/** Business day that a reading taken right now would close. */
export async function closingBusinessDate(c: ClientBase): Promise<string> {
  const r = await c.query("SELECT reading_business_date($1, now())::text AS d", [await siteId(c)]);
  return r.rows[0].d;
}

export async function getBoard(c: ClientBase): Promise<Board> {
  const closingDate = await closingBusinessDate(c);
  const r = await c.query(
    `SELECT n.id, st.name AS station_name, n.label, f.code AS fuel_code, f.short AS fuel_short, n.active AND st.active AS active,
            EXISTS (SELECT 1 FROM meter_points p WHERE p.nozzle_id = n.id AND p.point_type = 'BASELINE') AS has_baseline,
            lp.id AS last_id, lp.reading::text AS last_reading, lp.effective_at AS last_at, u.name AS last_by,
            lp.business_date::text AS last_date, lp.point_type AS last_type,
            EXISTS (SELECT 1 FROM meter_points p WHERE p.nozzle_id = n.id AND p.business_date = $1
                      AND p.point_type = 'DAY_END') AS done,
            (SELECT count(*)::int FROM v_open_meter_flags f WHERE f.nozzle_id = n.id) AS open_flags
       FROM nozzles n JOIN stations st ON st.id = n.station_id JOIN fuel_types f ON f.id = n.fuel_type_id
       LEFT JOIN LATERAL (SELECT * FROM v_meter_points_live l WHERE l.nozzle_id = n.id
                          ORDER BY l.effective_at DESC, l.seq DESC LIMIT 1) lp ON true
       LEFT JOIN users u ON u.id = lp.entered_by
      ORDER BY st.sort_order, n.sort_order, n.number`,
    [closingDate],
  );
  return r.rows.map((x) => ({
    nozzleId: x.id,
    stationName: x.station_name,
    label: x.label,
    fuelCode: x.fuel_code,
    fuelShort: x.fuel_short,
    active: x.active,
    hasBaseline: x.has_baseline,
    last: x.last_id
      ? { pointId: x.last_id, reading: x.last_reading, at: new Date(x.last_at).toISOString(), byName: x.last_by, businessDate: x.last_date, type: x.last_type }
      : null,
    closingDate,
    doneForClosingDate: x.done,
    openFlags: x.open_flags,
  }));
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------
export async function getRates(c: ClientBase, date: string) {
  const r = await c.query(
    `SELECT f.code, f.short, f.name_en, f.name_hi, r.rate::text AS rate, r.set_at, u.name AS set_by
       FROM fuel_types f
       LEFT JOIN v_daily_rates r ON r.fuel_type_id = f.id AND r.business_date = $1
       LEFT JOIN users u ON u.id = r.set_by
      WHERE f.active ORDER BY f.code DESC`,
    [date],
  );
  return r.rows as Array<{ code: string; short: string; name_en: string; name_hi: string; rate: string | null; set_at: Date | null; set_by: string | null }>;
}

const RATE_RE = /^\d{1,3}(\.\d{1,2})?$/;

export async function setRate(
  c: ClientBase,
  userId: string,
  input: { fuelCode: string; rate: string; businessDate?: string; reason?: string | null },
): Promise<{ businessDate: string; rate: string }> {
  const raw = String(input.rate ?? "").trim();
  if (!RATE_RE.test(raw) || new D(raw).lte(0)) throw Errors.badInput("Rate must be like 95.11 (rupees per litre).");
  const date = input.businessDate ?? (await currentBusinessDate(c));
  const f = await c.query("SELECT id FROM fuel_types WHERE code = $1 AND active", [input.fuelCode]);
  if (!f.rowCount) throw Errors.badInput("Unknown fuel.");
  await c.query(
    "INSERT INTO daily_rates (site_id, fuel_type_id, business_date, rate, reason, set_by) VALUES ($1,$2,$3,$4,$5,$6)",
    [await siteId(c), f.rows[0].id, date, new D(raw).toFixed(2), input.reason ?? null, userId],
  );
  return { businessDate: date, rate: new D(raw).toFixed(2) };
}

// ---------------------------------------------------------------------------
// Baseline (go-live): the owner records each nozzle's starting totalizer once.
// ---------------------------------------------------------------------------
export async function setBaseline(
  c: ClientBase,
  userId: string,
  input: { nozzleId: string; reading: string; idempotencyKey: string },
): Promise<{ pointId: string }> {
  const n = await c.query("SELECT id FROM nozzles WHERE id = $1 FOR UPDATE", [input.nozzleId]);
  if (!n.rowCount) throw Errors.badInput("Nozzle not found.");
  if ((await c.query("SELECT 1 FROM meter_points WHERE nozzle_id = $1", [input.nozzleId])).rowCount)
    throw new AppError("HAS_BASELINE", 409, "This nozzle already has its starting reading. Use a correction instead.", "इस नोज़ल की शुरुआती रीडिंग पहले से है।");
  const digits = await c.query(
    "SELECT key, (value #>> '{}')::int v FROM settings WHERE key IN ('meter_int_digits_default','meter_decimals_default')",
  );
  const m = Object.fromEntries(digits.rows.map((x) => [x.key, x.v]));
  const intDigits = m.meter_int_digits_default ?? 7;
  const decimals = m.meter_decimals_default ?? 2;
  const reading = parseReading(input.reading, intDigits, decimals);
  if (reading instanceof AppError) throw reading;
  await c.query("INSERT INTO meter_epochs (nozzle_id, epoch, int_digits, decimals, created_by) VALUES ($1, 1, $2, $3, $4)", [
    input.nozzleId,
    intDigits,
    decimals,
    userId,
  ]);
  const p = await c.query(
    `INSERT INTO meter_points (nozzle_id, epoch, reading, cumulative, point_type, business_date, entered_by, idempotency_key)
     VALUES ($1, 1, $2, $2, 'BASELINE', $3, $4, $5) RETURNING id`,
    // The starting reading counts as the closing of the business day that is ending, like any day-end.
    [input.nozzleId, reading, await closingBusinessDate(c), userId, input.idempotencyKey],
  );
  return { pointId: p.rows[0].id };
}

/** H1 + H2: digits only, at most the meter's decimals and integer digits. Returns the normalised string. */
export function parseReading(raw: string, intDigits: number, decimals: number): string | AppError {
  const s = String(raw ?? "").replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s))
    return new AppError("H1_NOT_A_NUMBER", 422, "Type the meter number using digits only.", "मीटर नंबर केवल अंकों में लिखें।");
  const [i, f = ""] = s.split(".");
  if (f.length > decimals)
    return new AppError("H2_DECIMALS", 422, `The meter shows only ${decimals} digits after the point.`, `दशमलव के बाद केवल ${decimals} अंक।`);
  if (i.replace(/^0+(?=\d)/, "").length > intDigits)
    return new AppError("H2_TOO_LONG", 422, `The meter shows only ${intDigits} digits before the point.`, `दशमलव से पहले केवल ${intDigits} अंक।`);
  return new D(s).toFixed(decimals);
}

// ---------------------------------------------------------------------------
// Day-end reading: evaluate (preview) and save use the same rules.
// ---------------------------------------------------------------------------
export type Evaluation = {
  nozzleId: string;
  label: string;
  closingDate: string;
  opening: string;
  closing: string;
  litres: string;
  testsReturned: string;
  testsNotReturned: string;
  customerLitres: string;
  rate: string | null;
  value: string | null;
  flags: Array<{ code: FlagCode; en: string; hi: string; detail: Record<string, unknown> }>;
  prevPointId: string;
};

type Ctx = {
  nozzle: { id: string; label: string; active: boolean; maxFlow: string; fuelTypeId: string; siteId: string };
  last: { id: string; reading: string; cumulative: string; epoch: number; wrap: number; at: Date; businessDate: string; type: string };
  epoch: { intDigits: number; decimals: number; modulus: string };
  closingDate: string;
};

async function loadCtx(c: ClientBase, nozzleId: string, lock: boolean): Promise<Ctx | AppError> {
  const n = await c.query(
    `SELECT n.id, n.label, n.active AND st.active AS active, n.max_flow_lpm::text AS max_flow, n.fuel_type_id, st.site_id
       FROM nozzles n JOIN stations st ON st.id = n.station_id WHERE n.id = $1 ${lock ? "FOR UPDATE OF n" : ""}`,
    [nozzleId],
  );
  if (!n.rowCount) return Errors.badInput("Nozzle not found.");
  const nz = n.rows[0];
  if (!nz.active)
    return new AppError("H5_INACTIVE", 422, "This nozzle is switched off in setup.", "यह नोज़ल बंद है।");
  const l = await c.query(
    `SELECT id, reading::text, cumulative::text, epoch, wrap_count, effective_at, business_date::text, point_type
       FROM v_meter_points_live WHERE nozzle_id = $1 ORDER BY effective_at DESC, seq DESC LIMIT 1`,
    [nozzleId],
  );
  if (!l.rowCount)
    return new AppError("H5_NO_BASELINE", 422, "The owner has not entered this nozzle's starting reading yet.", "मालिक ने शुरुआती रीडिंग नहीं डाली है।");
  const last = l.rows[0];
  const e = await c.query("SELECT int_digits, decimals, modulus::text FROM meter_epochs WHERE nozzle_id = $1 AND epoch = $2", [
    nozzleId,
    last.epoch,
  ]);
  const cd = await c.query("SELECT reading_business_date($1, now())::text AS d", [nz.site_id]);
  return {
    nozzle: { id: nz.id, label: nz.label, active: nz.active, maxFlow: nz.max_flow, fuelTypeId: nz.fuel_type_id, siteId: nz.site_id },
    last: {
      id: last.id,
      reading: last.reading,
      cumulative: last.cumulative,
      epoch: last.epoch,
      wrap: last.wrap_count,
      at: last.effective_at,
      businessDate: last.business_date,
      type: last.point_type,
    },
    epoch: { intDigits: e.rows[0].int_digits, decimals: e.rows[0].decimals, modulus: e.rows[0].modulus },
    closingDate: cd.rows[0].d,
  };
}

async function evaluate(
  c: ClientBase,
  ctx: Ctx,
  raw: string,
  prevPointId: string | undefined,
): Promise<Evaluation | AppError> {
  const reading = parseReading(raw, ctx.epoch.intDigits, ctx.epoch.decimals);
  if (reading instanceof AppError) return reading;
  if (prevPointId && prevPointId !== ctx.last.id)
    return new AppError("H4_STALE", 409, "Someone else entered a reading for this nozzle just now. The screen will reload.", "किसी और ने अभी रीडिंग डाली है। पेज फिर से खुलेगा।");
  const dup = await c.query("SELECT 1 FROM meter_points WHERE nozzle_id = $1 AND business_date = $2 AND point_type = 'DAY_END'", [
    ctx.nozzle.id,
    ctx.closingDate,
  ]);
  if (dup.rowCount)
    return new AppError("DUPLICATE_DAY_END", 409, `The closing reading for ${ctx.closingDate} is already saved for this nozzle.`, "इस दिन की रीडिंग पहले से सेव है।");
  if (ctx.closingDate <= ctx.last.businessDate)
    return new AppError(
      "H4_SEQUENCE",
      409,
      `The reading for ${ctx.last.businessDate} is already recorded for this nozzle. The next reading is due at the next day's closing time.`,
      "इस दिन की रीडिंग पहले से दर्ज है। अगली रीडिंग अगले दिन।",
    );

  const cumulative = new D(reading).plus(new D(ctx.last.wrap).times(ctx.epoch.modulus));
  if (cumulative.lt(ctx.last.cumulative)) {
    const nearMax = new D(ctx.last.reading).gte(new D(ctx.epoch.modulus).times("0.99"));
    return new AppError(
      "H3_DECREASE",
      422,
      nearMax
        ? `Lower than the last reading (${ctx.last.reading}). If the meter crossed its maximum and restarted, tell the owner (rollover).`
        : `Lower than the last reading (${ctx.last.reading}). Check the number on the meter.`,
      `पिछली रीडिंग (${ctx.last.reading}) से कम है। मीटर दोबारा देखें।`,
    );
  }

  const litres = cumulative.minus(ctx.last.cumulative);
  const t = await c.query(
    `SELECT COALESCE(SUM(litres) FILTER (WHERE returned_to_tank), 0)::text AS ret,
            COALESCE(SUM(litres) FILTER (WHERE NOT returned_to_tank), 0)::text AS notret
       FROM nozzle_tests t WHERE t.nozzle_id = $1 AND t.tested_at > $2
        AND NOT EXISTS (SELECT 1 FROM nozzle_test_voids v WHERE v.test_id = t.id)`,
    [ctx.nozzle.id, ctx.last.at],
  );
  const testsRet = new D(t.rows[0].ret);
  const testsNot = new D(t.rows[0].notret);
  const customer = litres.minus(testsRet).minus(testsNot);
  const rr = await c.query("SELECT rate::text FROM v_daily_rates WHERE site_id = $1 AND fuel_type_id = $2 AND business_date = $3", [
    ctx.nozzle.siteId,
    ctx.nozzle.fuelTypeId,
    ctx.closingDate,
  ]);
  const rate: string | null = rr.rows[0]?.rate ?? null;

  const flags: Evaluation["flags"] = [];
  const flag = (code: FlagCode, detail: Record<string, unknown>) => flags.push({ code, ...FLAG_TEXT[code], detail });
  if (litres.isZero()) flag("ZERO_THROUGHPUT", {});
  if (customer.lt(0)) flag("HIGH_VOLUME", { reason: "tests exceed throughput", tests: testsRet.plus(testsNot).toFixed(3) });
  const minutes = Math.max(1, (Date.now() - new Date(ctx.last.at).getTime()) / 60000);
  const maxPossible = new D(ctx.nozzle.maxFlow).times(minutes);
  if (litres.gt(maxPossible)) flag("IMPLAUSIBLE_RATE", { litres: litres.toFixed(2), minutes: Math.round(minutes), maxPossible: maxPossible.toFixed(0) });
  const daysGap = (Date.parse(ctx.closingDate) - Date.parse(ctx.last.businessDate)) / 86400000;
  if (ctx.last.type !== "BASELINE" && daysGap > 1) flag("MULTI_DAY_SEGMENT", { days: daysGap });
  const med = await c.query(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY throughput)::text AS median, count(*)::int AS n
       FROM (SELECT throughput FROM v_meter_segments WHERE nozzle_id = $1 AND kind = 'NORMAL' AND throughput > 0
              ORDER BY end_at DESC LIMIT 14) x`,
    [ctx.nozzle.id],
  );
  if (med.rows[0].n >= 7 && !litres.isZero()) {
    const median = new D(med.rows[0].median);
    if (litres.gt(median.times(3))) flag("HIGH_VOLUME", { median: median.toFixed(2) });
    else if (litres.lt(median.times("0.25"))) flag("LOW_VOLUME", { median: median.toFixed(2) });
  }

  return {
    nozzleId: ctx.nozzle.id,
    label: ctx.nozzle.label,
    closingDate: ctx.closingDate,
    opening: ctx.last.reading,
    closing: reading,
    litres: litres.toFixed(2),
    testsReturned: testsRet.toFixed(3),
    testsNotReturned: testsNot.toFixed(3),
    customerLitres: customer.toFixed(3),
    rate,
    value: rate ? round2(customer.times(rate)) : null,
    flags,
    prevPointId: ctx.last.id,
  };
}

/**
 * Check for the confirmation screen ("Litres = 450.50 · Value ₹42,347.00"). Saves no reading, but a
 * refused value is logged as a blocked attempt (evidence), exactly as on save.
 */
export async function previewDayEnd(
  c: ClientBase,
  input: { nozzleId: string; reading: string },
  user?: { id: string },
  ip?: string | null,
): Promise<Evaluation | Blocked> {
  const ctx = await loadCtx(c, input.nozzleId, false);
  if (ctx instanceof AppError) throw ctx;
  const ev = await evaluate(c, ctx, input.reading, undefined);
  if (ev instanceof AppError) {
    if (!user) throw ev;
    await c.query(
      "INSERT INTO meter_entry_attempts (nozzle_id, user_id, attempted_value, expected_min, rule_code, ip) VALUES ($1,$2,$3,$4,$5,$6)",
      [input.nozzleId, user.id, String(input.reading ?? "").slice(0, 40), ctx.last.reading, ev.code, ip ?? null],
    );
    return new Blocked(ev);
  }
  return ev;
}

/**
 * Saves a day-end reading in one transaction: lock nozzle, re-check every rule against the latest chain,
 * insert the point (DB assigns seq + hash), write flags. A blocked attempt is logged and committed,
 * and the caller reports NOT saved.
 */
export async function saveDayEnd(
  c: ClientBase,
  user: { id: string },
  input: { nozzleId: string; reading: string; prevPointId: string; idempotencyKey: string; ip?: string | null },
): Promise<(Evaluation & { pointId: string; status: "ACCEPTED" | "REVIEW" }) | Blocked> {
  const ctx = await loadCtx(c, input.nozzleId, true);
  const logAttempt = async (rule: string, expectedMin: string | null) =>
    c.query("INSERT INTO meter_entry_attempts (nozzle_id, user_id, attempted_value, expected_min, rule_code, ip) VALUES ($1,$2,$3,$4,$5,$6)", [
      input.nozzleId,
      user.id,
      String(input.reading ?? "").slice(0, 40),
      expectedMin,
      rule,
      input.ip ?? null,
    ]);
  if (ctx instanceof AppError) {
    if (ctx.code !== "BAD_INPUT") await logAttempt(ctx.code, null);
    return new Blocked(ctx);
  }
  const ev = await evaluate(c, ctx, input.reading, input.prevPointId);
  if (ev instanceof AppError) {
    await logAttempt(ev.code, ctx.last.reading);
    return new Blocked(ev);
  }
  const p = await c.query(
    `INSERT INTO meter_points (nozzle_id, epoch, wrap_count, reading, cumulative, point_type, business_date, entered_by, ip, idempotency_key)
     VALUES ($1, $2, $3, $4, 0, 'DAY_END', $5, $6, $7, $8) RETURNING id`,
    [input.nozzleId, ctx.last.epoch, ctx.last.wrap, ev.closing, ev.closingDate, user.id, input.ip ?? null, input.idempotencyKey],
  );
  const pointId = p.rows[0].id as string;
  for (const f of ev.flags) {
    await c.query("INSERT INTO meter_flags (nozzle_id, point_id, business_date, code, severity, detail) VALUES ($1,$2,$3,$4,'REVIEW',$5)", [
      input.nozzleId,
      pointId,
      ev.closingDate,
      f.code,
      JSON.stringify(f.detail),
    ]);
  }
  await c.query("SELECT pg_notify('pump_events', $1)", [JSON.stringify({ type: "reading", nozzleId: input.nozzleId })]);
  return { ...ev, pointId, status: ev.flags.length ? "REVIEW" : "ACCEPTED" };
}

// ---------------------------------------------------------------------------
// Owner review of flagged readings (accept as is / no sale). Corrections come later.
// ---------------------------------------------------------------------------
export async function listOpenFlags(c: ClientBase) {
  const r = await c.query(
    `SELECT f.id, f.code, f.business_date::text AS date, f.detail, n.label, st.name AS station, p.reading::text AS reading, u.name AS entered_by
       FROM v_open_meter_flags f JOIN nozzles n ON n.id = f.nozzle_id JOIN stations st ON st.id = n.station_id
       LEFT JOIN meter_points p ON p.id = f.point_id LEFT JOIN users u ON u.id = p.entered_by
      ORDER BY f.raised_at`,
  );
  return r.rows.map((x) => ({ ...x, text: FLAG_TEXT[x.code as FlagCode] ?? { en: x.code, hi: "" } }));
}

export async function reviewFlag(c: ClientBase, reviewerId: string, input: { flagId: string; decision: "ACCEPT_AS_IS" | "MARK_NO_SALE"; reason: string }) {
  if (String(input.reason ?? "").trim().length < 5) throw Errors.badInput("Write a short reason (at least 5 letters).");
  await c.query("INSERT INTO meter_reviews (flag_id, decision, reason, reviewer_id) VALUES ($1,$2,$3,$4)", [
    input.flagId,
    input.decision,
    input.reason.trim(),
    reviewerId,
  ]);
}

// ---------------------------------------------------------------------------
// Day sheet: the right-hand page of the Rokad (readings, litres x rate = sales).
// ---------------------------------------------------------------------------
export async function getDaySheet(c: ClientBase, date: string) {
  const rows = await c.query(
    `SELECT n.id AS nozzle_id, st.name AS station, n.label, f.code AS fuel, f.short,
            s.start_reading::text AS opening, s.end_reading::text AS closing, s.throughput::text AS litres,
            s.tests_returned::text, s.tests_not_returned::text, s.customer_litres::text, s.rate::text,
            s.sales_value::text AS value, s.confirmed, s.kind
       FROM nozzles n JOIN stations st ON st.id = n.station_id JOIN fuel_types f ON f.id = n.fuel_type_id
       LEFT JOIN v_meter_segments s ON s.nozzle_id = n.id AND s.business_date = $1 AND s.end_type = 'DAY_END'
      WHERE n.active AND st.active
      ORDER BY st.sort_order, n.sort_order, n.number`,
    [date],
  );
  const byFuel = new Map<string, { fuel: string; short: string; litres: Dec; value: Dec; rate: string | null; complete: boolean; provisional: Dec }>();
  for (const r of rows.rows) {
    const k = byFuel.get(r.fuel) ?? { fuel: r.fuel, short: r.short, litres: new D(0), value: new D(0), rate: r.rate, complete: true, provisional: new D(0) };
    if (r.closing == null) k.complete = false;
    else {
      k.litres = k.litres.plus(r.customer_litres);
      if (r.value != null) k.value = k.value.plus(r.value);
      if (!r.confirmed && r.value != null) k.provisional = k.provisional.plus(r.value);
      k.rate ??= r.rate;
    }
    byFuel.set(r.fuel, k);
  }
  const fuels = [...byFuel.values()].map((f) => ({
    fuel: f.fuel,
    short: f.short,
    litres: f.litres.toFixed(3),
    rate: f.rate,
    value: f.value.toFixed(2),
    provisionalValue: f.provisional.toFixed(2),
    complete: f.complete,
  }));
  const total = fuels.reduce((a, f) => a.plus(f.value), new D(0)).toFixed(2);
  return { date, nozzles: rows.rows, fuels, total };
}
