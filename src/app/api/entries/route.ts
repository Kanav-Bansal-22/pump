import { z } from "zod";
import { apiPost } from "@/server/http";
import { createEntry, ENTRY_KINDS, type EntryKind } from "@/server/money/service";

const Party = z.object({ id: z.uuid().nullable().optional(), name: z.string().max(80).nullable().optional(), phone: z.string().max(15).nullable().optional() });

/** Any Rokad line: udhari given/received, payments, lube and other receipts. Idempotent. */
export const POST = apiPost(
  {
    endpoint: "entries",
    idempotent: true,
    input: z.object({
      kind: z.enum(Object.keys(ENTRY_KINDS) as [EntryKind, ...EntryKind[]]),
      businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      party: Party.nullable().optional(),
      expenseCode: z.string().max(10).nullable().optional(),
      mode: z.string().max(20).nullable().optional(),
      amount: z.string().trim().min(1, "Enter the amount").max(20),
      vehicleNo: z.string().max(20).nullable().optional(),
      slipNo: z.string().max(20).nullable().optional(),
      fuelCode: z.enum(["PETROL", "DIESEL"]).nullable().optional(),
      litres: z.string().max(12).nullable().optional(),
      description: z.string().max(200).nullable().optional(),
    }),
  },
  async ({ c, user, input, req }) => createEntry(c, user, input, req.headers.get("idempotency-key")!),
);
