import { Bi } from "@/components/ui";
import { Page } from "@/components/page";
import { listUsers } from "@/server/config/service";
import { pool } from "@/server/db";
import { requireUser } from "@/server/session";
import { UsersEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await requireUser("users.manage");
  const c = await pool().connect();
  const users = await listUsers(c).finally(() => c.release());
  return (
    <Page title={<Bi en="Staff logins" hi="कर्मचारी लॉगिन" />} back="/settings">
      <UsersEditor
        meId={me.id}
        users={users.map((u) => ({ ...u, lastLogin: u.lastLogin ? new Date(u.lastLogin).toLocaleString("en-IN") : null }))}
      />
    </Page>
  );
}
