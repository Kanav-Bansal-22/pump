import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import { getSessionUser } from "@/server/auth/service";
import { withTx } from "@/server/db";
import { Errors } from "@/server/errors";
import { SESSION_COOKIE, apiPost, clientIp, errorResponse } from "@/server/http";
import { backupRoot, takeBackup } from "@/server/ops/backup";

/** Owner: "Back up now". */
export const POST = apiPost(
  { endpoint: "owner.backups", permission: "backup.manage", input: z.object({ action: z.literal("run") }) },
  async () => {
    const r = await takeBackup("MANUAL");
    if (!r.ok) throw new Error(`Backup failed: ${r.error}`);
    return { file: basename(r.file!), size: r.size, sha256: r.sha256 };
  },
);

/** Owner: download a backup file to the phone (the no-USB-drive off-laptop copy). */
export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  try {
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) throw Errors.badInput("Which backup?");
    const out = await withTx({ userId: null, requestId, ip: clientIp(req) }, async (c) => {
      const user = await getSessionUser(c, req.cookies.get(SESSION_COOKIE)?.value);
      if (!user) throw Errors.notLoggedIn();
      if (!user.permissions.includes("backup.manage")) throw Errors.forbidden();
      await c.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
      const b = await c.query("SELECT path FROM backup_log WHERE id = $1 AND ok", [id]);
      if (!b.rowCount) throw Errors.badInput("Backup not found.");
      await c.query("INSERT INTO backup_downloads (backup_id, user_id) VALUES ($1, $2)", [id, user.id]);
      return b.rows[0].path as string;
    });
    const path = resolve(out);
    if (!path.startsWith(backupRoot()) || !existsSync(path)) throw Errors.badInput("The backup file is no longer on the laptop.");
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
    return new NextResponse(stream, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(statSync(path).size),
        "content-disposition": `attachment; filename="${basename(path)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
