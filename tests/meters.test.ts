import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createUser } from "@/server/auth/service";
import { createStandardLayout } from "@/server/config/service";
import { Blocked } from "@/server/errors";
import { runIdempotent } from "@/server/idempotency";
import { getDaySheet, previewDayEnd, reviewFlag, saveDayEnd, setRate } from "@/server/meters/service";
import { connect, tx } from "./helpers/db";

let c: Client;
let ownerId = "";
let staffId = "";
let siteId = "";
const N: Record<string, string> = {}; // "S1:HSD A1" -> nozzle id

async function inTx<T>(fn: () => Promise<T>, cl: Client = c): Promise<T> {
  let out: T;
  const err = await tx(cl, async () => {
    out = await fn();
  });
  if (err) throw new Error(err);
  return out!;
}

let keyN = 0;
const key = () => `test-key-${Date.now()}-${++keyN}-xxxxxxxx`;

/** Inserts a meter point with a controlled date/time (scenario set-up). */
async function point(
  nozzle: string,
  reading: string,
  type: string,
  businessDate: string,
  at: string,
  o: { wrap?: number; epoch?: number } = {},
): Promise<string> {
  const r = await c.query(
    `INSERT INTO meter_points (nozzle_id, epoch, wrap_count, reading, cumulative, point_type, business_date,
                               taken_at, effective_at, entered_by, idempotency_key)
     VALUES ($1,$2,$3,$4,0,$5,$6,$7,$7,$8,$9) RETURNING id`,
    [nozzle, o.epoch ?? 1, o.wrap ?? 0, reading, type, businessDate, at, staffId, key()],
  );
  return r.rows[0].id;
}
const epoch = (nozzle: string, intDigits = 7) =>
  c.query("INSERT INTO meter_epochs (nozzle_id, epoch, int_digits, decimals, created_by) VALUES ($1,1,$2,2,$3)", [nozzle, intDigits, ownerId]);
const rate = (fuel: string, date: string, value: string, reason?: string) =>
  c.query(
    "INSERT INTO daily_rates (site_id, fuel_type_id, business_date, rate, reason, set_by) SELECT $1, id, $3, $4, $5, $6 FROM fuel_types WHERE code = $2",
    [siteId, fuel, date, value, reason ?? null, ownerId],
  );
const segment = async (endId: string) => (await c.query("SELECT * FROM v_meter_segments WHERE end_id = $1", [endId])).rows[0];

beforeAll(async () => {
  c = await connect("app", "pump_test_meters");
  ownerId = await inTx(() => createUser(c, { name: "Owner M", username: "owner_m", tempPassword: "owner-pass-1", role: "OWNER" }));
  staffId = await inTx(() => createUser(c, { name: "Staff M", username: "staff_m", tempPassword: "staff-pass-1", role: "STAFF" }));
  await inTx(() => createStandardLayout(c, "Meter Test Pump"));
  siteId = (await c.query("SELECT id FROM sites LIMIT 1")).rows[0].id;
  const r = await c.query("SELECT n.id, s.code, n.label FROM nozzles n JOIN stations s ON s.id = n.station_id");
  for (const x of r.rows) N[`${x.code}:${x.label}`] = x.id;
});
afterAll(async () => {
  await c.end();
});

describe("business day (8 AM cut-over, readings 05:00-11:00 close the previous day)", () => {
  it.each([
    ["2026-11-12 04:00+05:30", "2026-11-11"],
    ["2026-11-12 07:30+05:30", "2026-11-11"],
    ["2026-11-12 10:59+05:30", "2026-11-11"],
    ["2026-11-12 11:00+05:30", "2026-11-12"],
    ["2026-11-12 23:00+05:30", "2026-11-12"],
  ])("a reading at %s closes business day %s", async (at, expected) => {
    const r = await c.query("SELECT reading_business_date($1, $2::timestamptz)::text AS d", [siteId, at]);
    expect(r.rows[0].d).toBe(expected);
  });
});

describe("meter maths (addendum v1.1 TC-01..03, master prompt Part 5)", () => {
  it("throughput 450.50, tests 5 returned + 2 not returned: sales 443.50 L = ₹41,689.00, tank depletion 445.50", async () => {
    const n = N["S1:HSD A1"];
    await epoch(n);
    await point(n, "25000.00", "BASELINE", "2026-09-30", "2026-10-01 08:00+05:30");
    await c.query(
      "INSERT INTO nozzle_tests (nozzle_id, tested_at, litres, returned_to_tank, entered_by, idempotency_key) VALUES ($1,'2026-10-01 12:00+05:30',5,true,$2,$3)",
      [n, staffId, key()],
    );
    await c.query(
      "INSERT INTO nozzle_tests (nozzle_id, tested_at, litres, returned_to_tank, not_returned_reason, entered_by, idempotency_key) VALUES ($1,'2026-10-01 13:00+05:30',2,false,'kept as sample',$2,$3)",
      [n, staffId, key()],
    );
    await rate("DIESEL", "2026-10-01", "94.00");
    const end = await point(n, "25450.50", "DAY_END", "2026-10-01", "2026-10-02 08:00+05:30");
    const s = await segment(end);
    expect(s.throughput).toBe("450.50");
    expect(s.tests_returned).toBe("5.000");
    expect(s.tests_not_returned).toBe("2.000");
    expect(s.customer_litres).toBe("443.500");
    expect(s.net_tank_depletion).toBe("445.500");
    expect(s.sales_value).toBe("41689.00");
    expect(s.confirmed).toBe(true);
  });

  it("register page 224: MS 691.01 + 177.60 = 868.61 L × ₹105.17 = ₹91,351.71", async () => {
    for (const [label, open, close] of [
      ["S3:MS A1", "1028219.48", "1028910.49"],
      ["S3:MS A2", "764261.82", "764439.42"],
    ]) {
      await epoch(N[label]);
      await point(N[label], open, "BASELINE", "2026-11-08", "2026-11-09 08:00+05:30");
      await point(N[label], close, "DAY_END", "2026-11-09", "2026-11-10 08:00+05:30");
    }
    await rate("PETROL", "2026-11-09", "105.17");
    const sheet = await getDaySheet(c, "2026-11-09");
    const petrol = sheet.fuels.find((f) => f.fuel === "PETROL")!;
    expect(petrol.litres).toBe("868.610");
    expect(petrol.value).toBe("91351.71"); // 72,673.52 + 18,678.19, rounded per nozzle then summed
    expect(petrol.complete).toBe(true);
    const diesel = sheet.fuels.find((f) => f.fuel === "DIESEL")!;
    expect(diesel.complete).toBe(false); // diesel nozzles have no reading for that day
  });

  it("rollover keeps the same meter: 9,999,900.00 → 150.00 is 250.00 L (TC-08, modulus 1,00,00,000)", async () => {
    const n = N["S1:HSD A2"];
    await epoch(n);
    await point(n, "9999900.00", "BASELINE", "2026-10-01", "2026-10-02 08:00+05:30");
    const end = await point(n, "150.00", "ROLLOVER", "2026-10-02", "2026-10-03 08:00+05:30", { wrap: 1 });
    const s = await segment(end);
    expect(s.throughput).toBe("250.00");
    expect(s.kind).toBe("NORMAL");
    const p = await c.query("SELECT epoch, cumulative::text FROM meter_points WHERE id = $1", [end]);
    expect(p.rows[0]).toEqual({ epoch: 1, cumulative: "10000150.00" });
  });

  it("segments telescope exactly: sum of litres = last − first (INV-11)", async () => {
    const r = await c.query(
      `SELECT s.nozzle_id, SUM(s.throughput)::text AS total,
              (SELECT (max(cumulative) - min(cumulative))::text FROM meter_points p WHERE p.nozzle_id = s.nozzle_id) AS span
         FROM v_meter_segments s GROUP BY s.nozzle_id`,
    );
    for (const row of r.rows) expect(row.total).toBe(row.span);
  });

  it("the database itself refuses a lower reading and an impossible display value", async () => {
    const n = N["S1:HSD A1"];
    await expect(point(n, "25000.00", "DAY_END", "2026-10-03", "2026-10-04 08:00+05:30")).rejects.toThrow(/METER_DECREASE/);
    await expect(point(n, "10000000.00", "DAY_END", "2026-10-03", "2026-10-04 08:00+05:30")).rejects.toThrow(/METER_RANGE/);
  });

  it("test pours: more than 50 L, or not returned without a reason, are refused", async () => {
    await expect(
      c.query("INSERT INTO nozzle_tests (nozzle_id, litres, returned_to_tank, entered_by, idempotency_key) VALUES ($1,60,true,$2,$3)", [
        N["S1:HSD A1"],
        staffId,
        key(),
      ]),
    ).rejects.toThrow(/check constraint/);
    await expect(
      c.query("INSERT INTO nozzle_tests (nozzle_id, litres, returned_to_tank, entered_by, idempotency_key) VALUES ($1,2,false,$2,$3)", [
        N["S1:HSD A1"],
        staffId,
        key(),
      ]),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("staff entry rules (live, with today's server time)", () => {
  let closing = "";
  const n3 = () => N["S2:HSD A1"];
  const n4 = () => N["S2:HSD A2"];

  beforeAll(async () => {
    const d = (await c.query("SELECT reading_business_date($1, now())::text AS d, (reading_business_date($1, now()) - 1)::text AS prev", [siteId])).rows[0];
    closing = d.d;
    for (const n of [n3(), n4()]) {
      await epoch(n);
      await point(n, "8492191.87", "BASELINE", d.prev, new Date(Date.now() - 86400000).toISOString());
    }
    await rate("DIESEL", closing, "95.11");
  });

  const save = (n: string, reading: string, prev: string, k = key(), cl: Client = c) =>
    saveDayEnd(cl, { id: staffId }, { nozzleId: n, reading, prevPointId: prev, idempotencyKey: k });
  const lastId = async (n: string) =>
    (await c.query("SELECT id FROM v_meter_points_live WHERE nozzle_id = $1 ORDER BY effective_at DESC, seq DESC LIMIT 1", [n])).rows[0].id;

  it("H1/H2: letters, 3 decimals and 8 digits are refused before anything is saved", async () => {
    await expect(previewDayEnd(c, { nozzleId: n3(), reading: "84a96" })).rejects.toThrow(/digits only/);
    await expect(previewDayEnd(c, { nozzleId: n3(), reading: "8496290.945" })).rejects.toThrow(/2 digits after/);
    await expect(previewDayEnd(c, { nozzleId: n3(), reading: "12345678.00" })).rejects.toThrow(/7 digits before/);
  });

  it("preview shows litres, rate and value the way the register does (4,099.07 L × ₹95.11)", async () => {
    const p = await previewDayEnd(c, { nozzleId: n3(), reading: "8496290.94" });
    if (p instanceof Blocked) throw new Error(p.error.message);
    expect(p.opening).toBe("8492191.87");
    expect(p.litres).toBe("4099.07");
    expect(p.rate).toBe("95.11");
    expect(p.value).toBe("389862.55"); // 4099.07 × 95.11 = 389,862.5477
    expect(p.closingDate).toBe(closing);
  });

  it("H3: a lower reading is NOT saved, and the attempt is logged as evidence (TC-07)", async () => {
    const r = await inTx(() => save(n3(), "8492000.00", ""));
    expect(r).toBeInstanceOf(Blocked);
    expect((r as Blocked).error.code).toBe("H3_DECREASE");
    const a = await c.query("SELECT rule_code, attempted_value FROM meter_entry_attempts WHERE nozzle_id = $1", [n3()]);
    expect(a.rows).toContainEqual({ rule_code: "H3_DECREASE", attempted_value: "8492000.00" });
    expect((await c.query("SELECT count(*)::int n FROM meter_points WHERE nozzle_id = $1", [n3()])).rows[0].n).toBe(1);
  });

  it("a lower value refused at the CHECK step (before Save) is also logged as evidence", async () => {
    const before = (await c.query("SELECT count(*)::int n FROM meter_entry_attempts WHERE nozzle_id = $1", [n4()])).rows[0].n;
    const r = await inTx(() => previewDayEnd(c, { nozzleId: n4(), reading: "8400000.00" }, { id: staffId }, "10.0.0.9"));
    expect(r).toBeInstanceOf(Blocked);
    const a = await c.query(
      "SELECT rule_code, attempted_value, expected_min::text, ip FROM meter_entry_attempts WHERE nozzle_id = $1 ORDER BY at DESC LIMIT 1",
      [n4()],
    );
    expect(a.rows[0]).toEqual({ rule_code: "H3_DECREASE", attempted_value: "8400000.00", expected_min: "8492191.87", ip: "10.0.0.9" });
    expect((await c.query("SELECT count(*)::int n FROM meter_entry_attempts WHERE nozzle_id = $1", [n4()])).rows[0].n).toBe(before + 1);
  });

  it("H4: a form opened before someone else's save is refused (stale)", async () => {
    const r = await inTx(() => save(n3(), "8496290.94", "00000000-0000-4000-8000-000000000000"));
    expect((r as Blocked).error.code).toBe("H4_STALE");
  });

  it("zero litres is saved but sent for review; only the owner can accept it", async () => {
    const prev = await lastId(n3());
    const r = await inTx(() => save(n3(), "8492191.87", prev));
    if (r instanceof Blocked) throw new Error(r.error.message);
    expect(r.status).toBe("REVIEW");
    expect(r.flags.map((f) => f.code)).toEqual(["ZERO_THROUGHPUT"]);
    expect((await segment(r.pointId)).confirmed).toBe(false); // provisional until reviewed
    const flagId = (await c.query("SELECT id FROM meter_flags WHERE point_id = $1", [r.pointId])).rows[0].id;
    await expect(inTx(() => reviewFlag(c, staffId, { flagId, decision: "MARK_NO_SALE", reason: "nozzle idle" }))).rejects.toThrow(/Only the owner/);
    await inTx(() => reviewFlag(c, ownerId, { flagId, decision: "MARK_NO_SALE", reason: "nozzle idle all day" }));
    expect((await segment(r.pointId)).confirmed).toBe(true);
  });

  it("a second reading for a day already closed is refused", async () => {
    const prev = await lastId(n3());
    const r = await inTx(() => save(n3(), "8499999.00", prev));
    expect((r as Blocked).error.code).toMatch(/H4_SEQUENCE|DUPLICATE_DAY_END/);
  });

  it("double tap / retry with the same entry key saves once and returns the same answer (TC-19)", async () => {
    const k = key();
    const prev = await lastId(n4());
    const call = () => inTx(() => runIdempotent(c, { key: k, userId: staffId, endpoint: "readings.save", body: { r: "8496290.94" } }, () => save(n4(), "8496290.94", prev, k)));
    const a = await call();
    const b = await call();
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect((b.response as { pointId: string }).pointId).toBe((a.response as { pointId: string }).pointId);
    expect((await c.query("SELECT count(*)::int n FROM meter_points WHERE nozzle_id = $1", [n4()])).rows[0].n).toBe(2);
  });

  it("two phones saving the same nozzle at once: exactly one reading is kept (TC-18)", async () => {
    const n = N["S1:HSD A2"]; // last point is a past rollover, so a new day-end is allowed
    const prev = await lastId(n);
    const c2 = await connect("app", "pump_test_meters");
    try {
      const [r1, r2] = await Promise.all([inTx(() => save(n, "200.00", prev), c), inTx(() => save(n, "201.00", prev, key(), c2), c2)]);
      const blocked = [r1, r2].filter((r) => r instanceof Blocked);
      expect(blocked).toHaveLength(1);
      expect((blocked[0] as Blocked).error.code).toMatch(/H4_STALE|H4_SEQUENCE|DUPLICATE_DAY_END/);
      const seqs = (await c.query("SELECT seq FROM meter_points WHERE nozzle_id = $1 ORDER BY seq", [n])).rows.map((x) => Number(x.seq));
      expect(seqs).toEqual([1, 2, 3]); // contiguous, no duplicate
    } finally {
      await c2.end();
    }
  });
});

describe("daily rates", () => {
  it("changing a rate already set for a day needs a reason; the latest one counts", async () => {
    await inTx(() => setRate(c, ownerId, { fuelCode: "PETROL", rate: "105.17", businessDate: "2026-12-01" }));
    await expect(inTx(() => setRate(c, ownerId, { fuelCode: "PETROL", rate: "105.71", businessDate: "2026-12-01" }))).rejects.toThrow(/reason is required/);
    await inTx(() => setRate(c, ownerId, { fuelCode: "PETROL", rate: "105.71", businessDate: "2026-12-01", reason: "typed wrong digits" }));
    const r = await c.query("SELECT rate::text FROM v_daily_rates v JOIN fuel_types f ON f.id = v.fuel_type_id WHERE f.code = 'PETROL' AND business_date = '2026-12-01'");
    expect(r.rows[0].rate).toBe("105.71");
  });

  it("bad rate formats are refused", async () => {
    for (const bad of ["0", "abc", "95.111", "1000"]) await expect(inTx(() => setRate(c, ownerId, { fuelCode: "PETROL", rate: bad }))).rejects.toThrow();
  });

  it("rates cannot change after the day is locked", async () => {
    await c.query("SELECT lock_business_day_for_posting($1, '2026-12-02')", [siteId]);
    await c.query("UPDATE business_days SET status='SUBMITTED', submitted_by=$2, submitted_at=now() WHERE site_id=$1 AND business_date='2026-12-02'", [siteId, staffId]);
    await c.query("UPDATE business_days SET status='LOCKED', locked_by=$2, locked_at=now() WHERE site_id=$1 AND business_date='2026-12-02'", [siteId, ownerId]);
    await expect(inTx(() => setRate(c, ownerId, { fuelCode: "PETROL", rate: "100", businessDate: "2026-12-02" }))).rejects.toThrow(/DAY_LOCKED/);
  });
});

describe("tamper evidence (TC-22, TC-34)", () => {
  it("app and owner roles cannot UPDATE or DELETE readings", async () => {
    await expect(c.query("UPDATE meter_points SET reading = reading")).rejects.toThrow(/permission denied/);
    const owner = await connect("owner", "pump_test_meters");
    try {
      await expect(owner.query("UPDATE meter_points SET reading = reading")).rejects.toThrow(/IMMUTABLE/);
      await expect(owner.query("DELETE FROM meter_points")).rejects.toThrow(/IMMUTABLE/);
    } finally {
      await owner.end();
    }
  });

  it("every chain verifies; a superuser edit with triggers disabled is detected", async () => {
    expect((await c.query("SELECT * FROM verify_meter_chains()")).rowCount).toBe(0);
    const su = await connect("super", "pump_test_meters");
    try {
      await su.query("ALTER TABLE meter_points DISABLE TRIGGER USER");
      await su.query("UPDATE meter_points SET reading = '25440.50' WHERE nozzle_id = $1 AND point_type = 'DAY_END'", [N["S1:HSD A1"]]);
      await su.query("ALTER TABLE meter_points ENABLE TRIGGER USER");
    } finally {
      await su.end();
    }
    const bad = await c.query("SELECT nozzle_id, problem FROM verify_meter_chains()");
    expect(bad.rows).toContainEqual({ nozzle_id: N["S1:HSD A1"], problem: "row content changed" });
  });
});
