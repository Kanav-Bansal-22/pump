import { z } from "zod";
import { Errors } from "@/server/errors";
import { apiPost } from "@/server/http";
import { countCash, lockDay, reopenDay, reverseEntry } from "@/server/money/service";

const Date_ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("count"), date: Date_, counted: z.string().trim().min(1, "Enter the counted cash").max(20) }),
  z.object({ action: z.literal("reopen"), date: Date_ }),
  z.object({ action: z.literal("lock"), date: Date_, overrideReason: z.string().max(300).nullable().optional() }),
  z.object({ action: z.literal("cancelEntry"), entryId: z.uuid(), reason: z.string().max(300) }),
]);

/** Day closing: cash count + submit (staff), send back / lock / cancel an entry (owner). */
export const POST = apiPost({ endpoint: "day", input: Input, idempotent: true }, async ({ c, user, input, req }) => {
  switch (input.action) {
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
