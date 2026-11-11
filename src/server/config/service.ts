import type { ClientBase } from "pg";
import { AppError, Errors } from "../errors";

export type LayoutNozzle = { id: string; label: string; number: number; fuelCode: string; fuelShort: string; active: boolean };
export type LayoutStation = { id: string; code: string; name: string; active: boolean; nozzles: LayoutNozzle[] };
export type Layout = { site: { id: string; name: string; address: string | null; dayCutover: string } | null; stations: LayoutStation[] };

export async function getLayout(c: ClientBase): Promise<Layout> {
  const s = await c.query("SELECT id, name, address, to_char(day_cutover, 'HH24:MI') AS cut FROM sites WHERE active ORDER BY created_at LIMIT 1");
  if (!s.rowCount) return { site: null, stations: [] };
  const st = await c.query("SELECT id, code, name, active FROM stations WHERE site_id = $1 ORDER BY sort_order, code", [s.rows[0].id]);
  const nz = await c.query(
    `SELECT n.id, n.station_id, n.label, n.number, n.active, f.code AS fuel_code, f.short AS fuel_short
       FROM nozzles n JOIN fuel_types f ON f.id = n.fuel_type_id ORDER BY n.sort_order, n.number`,
  );
  return {
    site: { id: s.rows[0].id, name: s.rows[0].name, address: s.rows[0].address, dayCutover: s.rows[0].cut },
    stations: st.rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      active: r.active,
      nozzles: nz.rows
        .filter((n) => n.station_id === r.id)
        .map((n) => ({ id: n.id, label: n.label, number: n.number, fuelCode: n.fuel_code, fuelShort: n.fuel_short, active: n.active })),
    })),
  };
}

/**
 * Creates the outlet layout confirmed by the owner (master prompt + register page 224):
 *   Station 1 Diesel (HSD A1, HSD A2), Station 2 Diesel (HSD A1, HSD A2), Station 3 Petrol (MS A1, MS A2).
 * This is configuration, not business data. Names can be edited afterwards. Only allowed once.
 */
export async function createStandardLayout(c: ClientBase, siteName: string): Promise<void> {
  await c.query("SELECT pg_advisory_xact_lock(hashtext('pump_layout'))");
  if ((await c.query("SELECT 1 FROM sites")).rowCount) throw new AppError("LAYOUT_EXISTS", 409, "The layout already exists.", "लेआउट पहले से बना है।");
  const name = String(siteName ?? "").trim();
  if (name.length < 2) throw Errors.badInput("Enter the petrol pump's name.");

  const fuel = async (code: string, en: string, hi: string, short: string, colour: string) =>
    (await c.query(
      `INSERT INTO fuel_types (code, name_en, name_hi, short, colour) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
      [code, en, hi, short, colour],
    )).rows[0].id as string;
  const petrol = await fuel("PETROL", "Petrol", "पेट्रोल", "MS", "#16a34a");
  const diesel = await fuel("DIESEL", "Diesel", "डीज़ल", "HSD", "#2563eb");

  const site = (await c.query("INSERT INTO sites (name, day_cutover) VALUES ($1, '08:00') RETURNING id", [name])).rows[0].id;
  const plan: Array<[string, string, string, string]> = [
    ["S1", "Station 1 (Diesel)", diesel, "HSD"],
    ["S2", "Station 2 (Diesel)", diesel, "HSD"],
    ["S3", "Station 3 (Petrol)", petrol, "MS"],
  ];
  let order = 0;
  for (const [i, [code, sname, fuelId, short]] of plan.entries()) {
    const st = (await c.query("INSERT INTO stations (site_id, code, name, sort_order) VALUES ($1,$2,$3,$4) RETURNING id", [site, code, sname, i + 1])).rows[0].id;
    for (const n of [1, 2]) {
      await c.query(
        "INSERT INTO nozzles (station_id, fuel_type_id, number, label, sort_order) VALUES ($1,$2,$3,$4,$5)",
        [st, fuelId, n, `${short} A${n}`, ++order],
      );
    }
  }
}

export async function updateSite(c: ClientBase, input: { name: string; address?: string | null }): Promise<void> {
  const name = String(input.name ?? "").trim();
  if (name.length < 2) throw Errors.badInput("Enter the petrol pump's name.");
  const r = await c.query("UPDATE sites SET name = $1, address = $2 WHERE active", [name, input.address?.trim() || null]);
  if (!r.rowCount) throw Errors.badInput("No site configured yet.");
}

export async function updateStation(c: ClientBase, id: string, input: { name: string; active: boolean }): Promise<void> {
  const name = String(input.name ?? "").trim();
  if (name.length < 2) throw Errors.badInput("Enter a station name.");
  const r = await c.query("UPDATE stations SET name = $2, active = $3 WHERE id = $1", [id, name, !!input.active]);
  if (!r.rowCount) throw Errors.badInput("Station not found.");
}

export async function updateNozzle(c: ClientBase, id: string, input: { label: string; active: boolean }): Promise<void> {
  const label = String(input.label ?? "").trim();
  if (label.length < 1 || label.length > 30) throw Errors.badInput("Enter a nozzle name (max 30 letters).");
  const r = await c.query("UPDATE nozzles SET label = $2, active = $3 WHERE id = $1", [id, label, !!input.active]);
  if (!r.rowCount) throw Errors.badInput("Nozzle not found.");
}

export async function listUsers(c: ClientBase) {
  const r = await c.query(
    `SELECT u.id, u.name, u.username, u.role_code AS role, u.active, u.must_change_password AS "mustChange", u.home_view AS "homeView",
            (u.locked_until > now()) AS locked,
            (SELECT max(created_at) FROM sessions s WHERE s.user_id = u.id) AS "lastLogin"
       FROM users u ORDER BY u.active DESC, u.role_code, u.name`,
  );
  return r.rows as Array<{ id: string; name: string; username: string; role: string; active: boolean; mustChange: boolean; homeView: "register" | "simple"; locked: boolean; lastLogin: Date | null }>;
}
