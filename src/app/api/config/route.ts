import { z } from "zod";
import { createStandardLayout, updateNozzle, updateSite, updateStation } from "@/server/config/service";
import { apiPost } from "@/server/http";

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createLayout"), siteName: z.string().max(80) }),
  z.object({ action: z.literal("updateSite"), name: z.string().max(80), address: z.string().max(200).nullable().optional() }),
  z.object({ action: z.literal("updateStation"), id: z.uuid(), name: z.string().max(60), active: z.boolean() }),
  z.object({ action: z.literal("updateNozzle"), id: z.uuid(), label: z.string().max(30), active: z.boolean() }),
]);

/** Owner configuration changes. Every change is audited by the database. */
export const POST = apiPost({ endpoint: "config", permission: "settings.manage", input: Input }, async ({ c, input }) => {
  switch (input.action) {
    case "createLayout":
      await createStandardLayout(c, input.siteName);
      break;
    case "updateSite":
      await updateSite(c, input);
      break;
    case "updateStation":
      await updateStation(c, input.id, input);
      break;
    case "updateNozzle":
      await updateNozzle(c, input.id, input);
      break;
  }
  return {};
});
