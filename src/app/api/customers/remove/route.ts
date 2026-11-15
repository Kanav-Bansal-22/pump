import { z } from "zod";
import { apiPost } from "@/server/http";
import { removeCustomer } from "@/server/money/service";

/** Owner: remove an udhari customer (old balance cancelled, hidden from lists; nothing erased). Idempotent. */
export const POST = apiPost(
  { endpoint: "customers.remove", idempotent: true, input: z.object({ partyId: z.uuid(), reason: z.string().max(200) }) },
  async ({ c, user, input }) => removeCustomer(c, user, input),
);
