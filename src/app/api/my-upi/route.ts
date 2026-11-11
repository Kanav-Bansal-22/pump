import { z } from "zod";
import { apiPost } from "@/server/http";
import { setMyUpiTotal } from "@/server/money/service";

/** Employee: "my UPI total so far today" (replaces the previous figure). */
export const POST = apiPost(
  {
    endpoint: "my-upi",
    idempotent: true,
    input: z.object({
      amount: z.string().trim().min(1, "Type your UPI total").max(20),
      businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    }),
  },
  async ({ c, user, input, req }) => setMyUpiTotal(c, user, input, req.headers.get("idempotency-key")!),
);
