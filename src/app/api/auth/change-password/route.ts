import { z } from "zod";
import { changePassword } from "@/server/auth/service";
import { apiPost } from "@/server/http";

export const POST = apiPost(
  {
    endpoint: "auth.change-password",
    input: z.object({ oldPassword: z.string().max(128), newPassword: z.string().max(128) }),
  },
  async ({ c, user, input }) => {
    await changePassword(c, user, input.oldPassword, input.newPassword);
    return {};
  },
);
