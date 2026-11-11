import { z } from "zod";
import { Errors } from "@/server/errors";
import { apiPost } from "@/server/http";
import { partyStatement } from "@/server/money/service";

/** Customer panel on the register: balance and full history of one customer. */
export const POST = apiPost(
  { endpoint: "customers.statement", permission: "customer.view_balance", input: z.object({ partyId: z.uuid() }) },
  async ({ c, input }) => {
    const s = await partyStatement(c, input.partyId);
    if (s.party.kind !== "CUSTOMER") throw Errors.badInput("Not a customer.");
    const vehicles = (await c.query("SELECT DISTINCT vehicle_no FROM money_entries WHERE party_id = $1 AND vehicle_no IS NOT NULL", [input.partyId])).rows.map(
      (r) => r.vehicle_no as string,
    );
    return { ...s, vehicles };
  },
);
