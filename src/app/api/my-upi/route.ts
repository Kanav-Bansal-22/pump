import { z } from "zod";
import { apiPost } from "@/server/http";
import { addMyUpi, cancelMyUpi } from "@/server/money/service";

/** Employee: add one amount received on the QR (UPI) or the card machine, or cancel a wrongly typed one. Idempotent. */
export const POST = apiPost(
  {
    endpoint: "my-upi",
    idempotent: true,
    input: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("add"),
        amount: z.string().trim().min(1, "Type the amount").max(20),
        mode: z.enum(["UPI", "CARD"]).nullable().optional(),
        businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      }),
      z.object({ action: z.literal("cancel"), paymentId: z.uuid() }),
    ]),
  },
  async ({ c, user, input, req }) => {
    const key = req.headers.get("idempotency-key")!;
    return input.action === "add" ? addMyUpi(c, user, input, key) : cancelMyUpi(c, user, input.paymentId, key);
  },
);
