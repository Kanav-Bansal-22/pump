import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes } from "node:crypto";
import type { ClientBase } from "pg";
import { AppError, Errors } from "../errors";

export type Role = "OWNER" | "MANAGER" | "STAFF";
export type SessionUser = {
  id: string;
  name: string;
  username: string;
  role: Role;
  mustChangePassword: boolean;
  homeView: "register" | "simple";
  permissions: string[];
  sessionId: string;
};

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const USERNAME_RE = /^[a-z0-9_.]{3,32}$/;

export const sha256 = (s: string) => createHash("sha256").update(s).digest();
export const newToken = () => randomBytes(32).toString("base64url");

export function validatePassword(pw: string): void {
  if (typeof pw !== "string" || pw.length < 8 || pw.length > 128)
    throw new AppError("WEAK_PASSWORD", 400, "Password must be at least 8 characters.", "पासवर्ड कम से कम 8 अक्षर का होना चाहिए।");
}

export function normalizeUsername(u: string): string {
  const s = String(u ?? "").trim().toLowerCase();
  if (!USERNAME_RE.test(s))
    throw new AppError("BAD_USERNAME", 400, "Username: 3–32 letters/numbers, no spaces.", "यूज़रनेम: 3–32 अक्षर/अंक, बिना स्पेस।");
  return s;
}

export const hashPassword = (pw: string) => hash(pw);

let _dummy: Promise<string> | undefined;
const dummyHash = () => (_dummy ??= hash(randomBytes(16).toString("hex")));

/** True when no user exists yet (first run: show the owner-setup screen). */
export async function isFirstRun(c: ClientBase): Promise<boolean> {
  const r = await c.query("SELECT NOT EXISTS (SELECT 1 FROM users) AS first");
  return r.rows[0].first;
}

/** Creates the very first owner. Refuses once any user exists (race-safe via advisory lock). */
export async function createFirstOwner(c: ClientBase, input: { name: string; username: string; password: string }) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext('pump_first_owner'))");
  if (!(await isFirstRun(c))) throw new AppError("ALREADY_SET_UP", 409, "The owner account already exists.", "मालिक खाता पहले से बना है।");
  const name = String(input.name ?? "").trim();
  if (name.length < 2) throw Errors.badInput("Enter the owner's name.");
  validatePassword(input.password);
  const r = await c.query(
    `INSERT INTO users (name, username, password_hash, role_code, must_change_password)
     VALUES ($1, $2, $3, 'OWNER', false) RETURNING id`,
    [name, normalizeUsername(input.username), await hashPassword(input.password)],
  );
  return r.rows[0].id as string;
}

export async function createUser(
  c: ClientBase,
  input: { name: string; username: string; tempPassword: string; role: Role },
): Promise<string> {
  const name = String(input.name ?? "").trim();
  if (name.length < 2) throw Errors.badInput("Enter the person's name.");
  if (!["OWNER", "STAFF"].includes(input.role)) throw Errors.badInput("Role must be Owner or Staff.");
  validatePassword(input.tempPassword);
  const username = normalizeUsername(input.username);
  const exists = await c.query("SELECT 1 FROM users WHERE username = $1", [username]);
  if (exists.rowCount) throw new AppError("USERNAME_TAKEN", 409, "That username is already used.", "यह यूज़रनेम पहले से है।");
  const r = await c.query(
    `INSERT INTO users (name, username, password_hash, role_code, must_change_password, home_view)
     VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
    // employees open the two-option phone view; change to "full register" for the counter laptop login
    [name, username, await hashPassword(input.tempPassword), input.role, input.role === "STAFF" ? "simple" : "register"],
  );
  return r.rows[0].id as string;
}

export type LoginResult =
  | { ok: true; userId: string; token: string; mustChangePassword: boolean }
  | { ok: false; error: AppError };

/**
 * Password login. Returns (does not throw) on bad credentials so the caller COMMITs the failed-attempt
 * counter and the login_attempts row. Locks the account for 15 min after 5 failures.
 */
export async function loginWithPassword(
  c: ClientBase,
  input: { username: string; password: string; ip?: string | null; userAgent?: string | null; sessionHours: number },
): Promise<LoginResult> {
  const username = String(input.username ?? "").trim().toLowerCase();
  const bad = new AppError("BAD_LOGIN", 401, "Wrong username or password.", "यूज़रनेम या पासवर्ड गलत है।");
  const log = (success: boolean, reason: string | null) =>
    c.query("INSERT INTO login_attempts (username, ip, success, method, reason) VALUES ($1,$2,$3,'PASSWORD',$4)", [
      username.slice(0, 64),
      input.ip ?? null,
      success,
      reason,
    ]);

  const r = await c.query(
    `SELECT id, password_hash, active, failed_logins, locked_until > now() AS locked, must_change_password
       FROM users WHERE username = $1 FOR UPDATE`,
    [username],
  );
  const u = r.rows[0];
  if (!u || !u.active) {
    await verify(await dummyHash(), String(input.password ?? "")).catch(() => false); // same timing as a real check
    await log(false, u ? "inactive" : "unknown_user");
    return { ok: false, error: bad };
  }
  if (u.locked) {
    await log(false, "locked");
    return {
      ok: false,
      error: new AppError("LOCKED", 423, `Too many wrong tries. Try again after ${LOCK_MINUTES} minutes or ask the owner.`, `बहुत बार गलत प्रयास। ${LOCK_MINUTES} मिनट बाद कोशिश करें।`),
    };
  }
  const good = await verify(u.password_hash, String(input.password ?? "")).catch(() => false);
  if (!good) {
    const failed = u.failed_logins + 1;
    if (failed >= MAX_FAILED) {
      // lock, and restart the counter so the next window starts fresh
      await c.query("UPDATE users SET failed_logins = 0, locked_until = now() + make_interval(mins => $2) WHERE id = $1", [u.id, LOCK_MINUTES]);
    } else {
      await c.query("UPDATE users SET failed_logins = $2 WHERE id = $1", [u.id, failed]);
    }
    await log(false, "bad_password");
    return { ok: false, error: bad };
  }
  if (u.failed_logins !== 0) await c.query("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1", [u.id]);
  const token = await createSession(c, u.id, { ip: input.ip, userAgent: input.userAgent, hours: input.sessionHours });
  await log(true, null);
  return { ok: true, userId: u.id, token, mustChangePassword: u.must_change_password };
}

export async function createSession(
  c: ClientBase,
  userId: string,
  o: { ip?: string | null; userAgent?: string | null; hours: number },
): Promise<string> {
  const token = newToken();
  await c.query(
    `INSERT INTO sessions (user_id, token_hash, ip, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))`,
    [userId, sha256(token), o.ip ?? null, (o.userAgent ?? "").slice(0, 200), o.hours],
  );
  return token;
}

/** Resolves a session token to its user, sliding the expiry forward (at most every 10 min). */
export async function getSessionUser(c: ClientBase, token: string | undefined | null, slideHours?: number): Promise<SessionUser | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const r = await c.query(
    `SELECT s.id AS session_id, s.last_seen_at < now() - interval '10 minutes' AS stale,
            u.id, u.name, u.username, u.role_code, u.must_change_password, u.home_view
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.active`,
    [sha256(token)],
  );
  const s = r.rows[0];
  if (!s) return null;
  if (s.stale && slideHours) {
    await c.query(
      "UPDATE sessions SET last_seen_at = now(), expires_at = GREATEST(expires_at, now() + make_interval(hours => $2)) WHERE id = $1",
      [s.session_id, slideHours],
    );
  }
  const p = await c.query("SELECT permission_code FROM v_user_permissions WHERE user_id = $1 ORDER BY 1", [s.id]);
  return {
    id: s.id,
    name: s.name,
    username: s.username,
    role: s.role_code,
    mustChangePassword: s.must_change_password,
    homeView: s.home_view,
    permissions: p.rows.map((x) => x.permission_code),
    sessionId: s.session_id,
  };
}

export async function revokeSession(c: ClientBase, token: string): Promise<void> {
  await c.query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [sha256(token)]);
}

export async function revokeAllSessions(c: ClientBase, userId: string, exceptSessionId?: string): Promise<number> {
  const r = await c.query(
    "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND id IS DISTINCT FROM $2",
    [userId, exceptSessionId ?? null],
  );
  return r.rowCount ?? 0;
}

export async function changePassword(
  c: ClientBase,
  user: { id: string; sessionId: string },
  oldPw: string,
  newPw: string,
): Promise<void> {
  validatePassword(newPw);
  const r = await c.query("SELECT password_hash FROM users WHERE id = $1 FOR UPDATE", [user.id]);
  if (!r.rowCount || !(await verify(r.rows[0].password_hash, String(oldPw ?? "")).catch(() => false)))
    throw new AppError("BAD_LOGIN", 401, "Current password is wrong.", "मौजूदा पासवर्ड गलत है।");
  if (oldPw === newPw) throw Errors.badInput("Choose a new password different from the old one.");
  await c.query("UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1", [user.id, await hashPassword(newPw)]);
  await revokeAllSessions(c, user.id, user.sessionId); // log out other devices
}

/** Owner resets someone's password: temporary password, must change at next login, all sessions ended. */
export async function resetPassword(c: ClientBase, userId: string, tempPw: string): Promise<void> {
  validatePassword(tempPw);
  const r = await c.query(
    "UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL WHERE id = $1",
    [userId, await hashPassword(tempPw)],
  );
  if (!r.rowCount) throw Errors.badInput("User not found.");
  await revokeAllSessions(c, userId);
}

export async function setUserActive(c: ClientBase, actorId: string, userId: string, active: boolean): Promise<void> {
  if (actorId === userId && !active) throw Errors.badInput("You cannot deactivate your own account.");
  if (!active) {
    const owners = await c.query("SELECT count(*)::int n FROM users WHERE role_code = 'OWNER' AND active AND id <> $1", [userId]);
    const target = await c.query("SELECT role_code FROM users WHERE id = $1", [userId]);
    if (target.rows[0]?.role_code === "OWNER" && owners.rows[0].n === 0) throw Errors.badInput("At least one active owner is required.");
  }
  await c.query("UPDATE users SET active = $2 WHERE id = $1", [userId, active]);
  if (!active) await revokeAllSessions(c, userId);
}

export function hasPermission(u: SessionUser | null, perm: string): boolean {
  return !!u && u.permissions.includes(perm);
}

/** Which screen a login opens: the phone view with two options, or the full register (e.g. the counter laptop). */
export async function setHomeView(c: ClientBase, userId: string, view: "register" | "simple"): Promise<void> {
  const r = await c.query("UPDATE users SET home_view = $2 WHERE id = $1", [userId, view]);
  if (!r.rowCount) throw Errors.badInput("User not found.");
}
