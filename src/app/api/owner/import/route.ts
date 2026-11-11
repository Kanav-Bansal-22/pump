import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSessionUser } from "@/server/auth/service";
import { withTx } from "@/server/db";
import { Errors } from "@/server/errors";
import { SESSION_COOKIE, apiPost, clientIp, errorResponse } from "@/server/http";
import { addOpeningBalance, cancelImport, confirmImport, parseSignedAmount, previewImport, templateXlsx } from "@/server/money/opening";

const Date_ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), fileName: z.string().max(150), fileBase64: z.string().max(3_000_000), openingDate: Date_ }),
  z.object({ action: z.literal("confirm"), batchId: z.uuid(), registerTotal: z.string().max(30) }),
  z.object({ action: z.literal("cancel"), batchId: z.uuid() }),
  z.object({ action: z.literal("single"), partyId: z.uuid(), amount: z.string().max(30), date: Date_, remarks: z.string().max(200).nullable().optional() }),
]);

/** Owner: import old udhari balances (preview -> confirm with register total), or add one old balance. */
export const POST = apiPost({ endpoint: "owner.import", permission: "import.run", input: Input, idempotent: true }, async ({ c, user, input }) => {
  switch (input.action) {
    case "preview":
      return previewImport(c, user, input);
    case "confirm":
      return confirmImport(c, user, input);
    case "cancel":
      await cancelImport(c, input.batchId);
      return {};
    case "single": {
      const amount = parseSignedAmount(input.amount);
      if (amount == null || amount === "0.00") throw Errors.badInput("Type the old balance, e.g. 12500 (or -500 for an advance).");
      const p = await c.query("SELECT 1 FROM parties WHERE id = $1 AND kind = 'CUSTOMER'", [input.partyId]);
      if (!p.rowCount) throw Errors.badInput("Customer not found.");
      const site = (await c.query("SELECT id FROM sites WHERE active ORDER BY created_at LIMIT 1")).rows[0].id;
      await addOpeningBalance(c, user, { siteId: site, partyId: input.partyId, amount, date: input.date, remarks: input.remarks ?? null });
      return { amount };
    }
  }
});

/** Owner: download the Excel template. */
export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  try {
    await withTx({ userId: null, requestId, ip: clientIp(req) }, async (c) => {
      const u = await getSessionUser(c, req.cookies.get(SESSION_COOKIE)?.value);
      if (!u) throw Errors.notLoggedIn();
      if (!u.permissions.includes("import.run")) throw Errors.forbidden();
    });
    const buf = await templateXlsx();
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": 'attachment; filename="old-udhari-template.xlsx"',
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
