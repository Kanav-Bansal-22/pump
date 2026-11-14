import { z } from "zod";
import { apiPost } from "@/server/http";
import { recordTest, voidTest } from "@/server/meters/service";

/** Testing fuel: record a test, or cancel a wrongly entered one. Idempotent. */
export const POST = apiPost(
  {
    endpoint: "tests",
    idempotent: true,
    input: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("record"),
        nozzleId: z.uuid(),
        litres: z.string().trim().min(1, "Type the litres").max(10),
        returned: z.boolean(),
        reason: z.string().max(120).nullable().optional(),
      }),
      z.object({ action: z.literal("void"), testId: z.uuid(), reason: z.string().max(120) }),
    ]),
  },
  async ({ c, user, input, req }) =>
    input.action === "record" ? recordTest(c, user, input, req.headers.get("idempotency-key")!) : voidTest(c, user, input),
);
