import { z } from "zod";
import { createUser, resetPassword, revokeAllSessions, setUserActive } from "@/server/auth/service";
import { apiPost } from "@/server/http";

const Input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().max(80),
    username: z.string().max(64),
    tempPassword: z.string().max(128),
    role: z.enum(["OWNER", "STAFF"]),
  }),
  z.object({ action: z.literal("resetPassword"), userId: z.uuid(), tempPassword: z.string().max(128) }),
  z.object({ action: z.literal("setActive"), userId: z.uuid(), active: z.boolean() }),
  z.object({ action: z.literal("logoutEverywhere"), userId: z.uuid() }),
]);

/** Owner manages logins: create, reset password, deactivate, sign out of all phones (lost phone). */
export const POST = apiPost({ endpoint: "users", permission: "users.manage", input: Input, idempotent: true }, async ({ c, user, input }) => {
  switch (input.action) {
    case "create":
      return { userId: await createUser(c, input) };
    case "resetPassword":
      await resetPassword(c, input.userId, input.tempPassword);
      return {};
    case "setActive":
      await setUserActive(c, user.id, input.userId, input.active);
      return {};
    case "logoutEverywhere":
      return { revoked: await revokeAllSessions(c, input.userId) };
  }
});
