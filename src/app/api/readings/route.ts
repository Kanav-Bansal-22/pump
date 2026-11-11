import { z } from "zod";
import { apiPost, clientIp } from "@/server/http";
import { saveDayEnd } from "@/server/meters/service";

/** Staff: save the day's closing reading (idempotent: a double tap or retry saves once). */
export const POST = apiPost(
  {
    endpoint: "readings.save",
    permission: "meter.enter",
    idempotent: true,
    input: z.object({ nozzleId: z.uuid(), reading: z.string().trim().min(1, "Type the meter reading").max(20), prevPointId: z.uuid() }),
  },
  async ({ c, user, input, req }) =>
    saveDayEnd(c, user, { ...input, idempotencyKey: req.headers.get("idempotency-key")!, ip: clientIp(req) }),
);
