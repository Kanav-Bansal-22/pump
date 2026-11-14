import { z } from "zod";
import { Errors } from "@/server/errors";
import { apiPost } from "@/server/http";
import { countCash, declareCollections, endDay, lockDay, reopenDay, reverseEntry } from "@/server/money/service";

const Date_ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// partialRecord: staff may fill only some modes (e.g. just UPI)
const Amounts = z.partialRecord(z.enum(["UPI", "CARD", "BANK", "OTHER"]), z.string().max(20));
// each QR's Paytm total: worker's user id (or "SHOP") -> amount
const Qr = z.record(z.union([z.uuid(), z.literal("SHOP")]), z.string().max(20));
const Input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("endDay"),
    date: Date_,
    counted: z.string().trim().min(1, "Type the cash counted").max(20),
    overrideReason: z.string().max(300).nullable().optional(),
    collections: Amounts.nullable().optional(),
    qr: Qr.nullable().optional(),
  }),
  z.object({ action: z.literal("collections"), date: Date_, amounts: Amounts, qr: Qr.nullable().optional() }),
  z.object({ action: z.literal("count"), date: Date_, counted: z.string().trim().min(1, "Enter the counted cash").max(20) }),
  z.object({ action: z.literal("reopen"), date: Date_ }),
  z.object({ action: z.literal("lock"), date: Date_, overrideReason: z.string().max(300).nullable().optional() }),
  z.object({ action: z.literal("cancelEntry"), entryId: z.uuid(), reason: z.string().max(300) }),
]);

/** Day closing: End day (count + lock in one step), send back / cancel an entry (owner). */
export const POST = apiPost({ endpoint: "day", input: Input, idempotent: true }, async ({ c, user, input, req }) => {
  switch (input.action) {
    case "endDay":
      return endDay(c, user, { ...input, collections: input.collections as Record<string, string> | null | undefined }, req.headers.get("idempotency-key")!);
    case "collections":
      return declareCollections(c, user, { date: input.date, amounts: input.amounts as Record<string, string>, qr: input.qr }, req.headers.get("idempotency-key")!);
    case "count":
      if (!user.permissions.includes("cash.count")) throw Errors.forbidden();
      return countCash(c, user, input, req.headers.get("idempotency-key")!);
    case "reopen":
      await reopenDay(c, user, input.date);
      return {};
    case "lock":
      return lockDay(c, user, input);
    case "cancelEntry":
      await reverseEntry(c, user, input);
      return {};
  }
});
