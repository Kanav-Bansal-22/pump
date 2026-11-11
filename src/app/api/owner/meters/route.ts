import { z } from "zod";
import { Errors } from "@/server/errors";
import { apiPost } from "@/server/http";
import { reviewFlag, setBaseline, setRate } from "@/server/meters/service";

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setRate"), fuelCode: z.enum(["PETROL", "DIESEL"]), rate: z.string().max(10), reason: z.string().max(200).nullable().optional() }),
  z.object({ action: z.literal("setBaseline"), nozzleId: z.uuid(), reading: z.string().max(20) }),
  z.object({ action: z.literal("review"), flagId: z.uuid(), decision: z.enum(["ACCEPT_AS_IS", "MARK_NO_SALE"]), reason: z.string().max(300) }),
]);

const PERM = { setRate: "price.set", setBaseline: "settings.manage", review: "meter.review" } as const;

/** Owner: daily rates, go-live starting readings, review of flagged readings. */
export const POST = apiPost({ endpoint: "owner.meters", input: Input, idempotent: true }, async ({ c, user, input, req }) => {
  if (!user.permissions.includes(PERM[input.action])) throw Errors.forbidden();
  switch (input.action) {
    case "setRate":
      return setRate(c, user.id, input);
    case "setBaseline":
      return setBaseline(c, user.id, { ...input, idempotencyKey: req.headers.get("idempotency-key")! });
    case "review":
      await reviewFlag(c, user.id, input);
      return {};
  }
});
