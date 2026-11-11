import { z } from "zod";
import { apiPost, clientIp } from "@/server/http";
import { previewDayEnd } from "@/server/meters/service";

/** Staff: check for the confirmation screen. Saves no reading; refused values are logged as attempts. */
export const POST = apiPost(
  {
    endpoint: "readings.preview",
    permission: "meter.enter",
    input: z.object({ nozzleId: z.uuid(), reading: z.string().trim().min(1, "Type the meter reading").max(20) }),
  },
  async ({ c, input, user, req }) => previewDayEnd(c, input, user, clientIp(req)),
);
