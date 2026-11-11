import { Bi } from "@/components/ui";
import { Page } from "@/components/page";
import { getLayout } from "@/server/config/service";
import { pool } from "@/server/db";
import { requireUser } from "@/server/session";
import { SetupEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function OwnerSetupPage() {
  await requireUser("settings.manage");
  const c = await pool().connect();
  const layout = await getLayout(c).finally(() => c.release());
  return (
    <Page title={<Bi en="Pump setup" hi="पंप सेटअप" />} back="/settings">
      <SetupEditor layout={layout} />
    </Page>
  );
}
