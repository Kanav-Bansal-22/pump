import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getSessionUser, isFirstRun, type SessionUser } from "./auth/service";
import { pool } from "./db";
import { SESSION_COOKIE } from "./http";

/** Current user for server components (one lookup per request). */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const c = await pool().connect();
  try {
    return await getSessionUser(c, token);
  } finally {
    c.release();
  }
});

export const firstRun = cache(async (): Promise<boolean> => {
  const c = await pool().connect();
  try {
    return await isFirstRun(c);
  } finally {
    c.release();
  }
});

/** Page guard: redirects to login / password change / home as needed. */
export async function requireUser(permission?: string): Promise<SessionUser> {
  if (await firstRun()) redirect("/setup");
  const u = await currentUser();
  if (!u) redirect("/login");
  if (u.mustChangePassword) redirect("/change-password");
  if (permission && !u.permissions.includes(permission)) redirect("/");
  return u;
}
