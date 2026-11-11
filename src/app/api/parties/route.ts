import { z } from "zod";
import { Errors } from "@/server/errors";
import { apiPost } from "@/server/http";
import { searchParties } from "@/server/money/service";

/** Type-ahead search for customers / suppliers / lenders / staff. Balances only for users allowed to see them. */
export const POST = apiPost(
  { endpoint: "parties.search", input: z.object({ kind: z.enum(["CUSTOMER", "SUPPLIER", "LENDER", "EMPLOYEE"]), q: z.string().max(40) }) },
  async ({ c, user, input }) => {
    if (!["credit.create", "receipt.create", "payment.create"].some((p) => user.permissions.includes(p))) throw Errors.forbidden();
    const rows = await searchParties(c, input.kind, input.q);
    const showBalance = user.permissions.includes("customer.view_balance");
    return rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, balance: showBalance ? r.balance : null }));
  },
);
