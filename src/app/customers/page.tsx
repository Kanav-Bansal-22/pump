import { AutoRefresh } from "@/components/auto-refresh";
import { Page } from "@/components/page";
import { pool } from "@/server/db";
import { customerList } from "@/server/money/service";
import { requireUser } from "@/server/session";
import { CustomerTable } from "./table";

export const dynamic = "force-dynamic";

/** Udhari customers: everyone with their complete position. */
export default async function CustomersPage() {
  await requireUser("customer.view_balance");
  const c = await pool().connect();
  const rows = await customerList(c).finally(() => c.release());
  return (
    <Page title="Udhari customers · उधारी खाते" active="customers" wide>
      <div className="-mt-2 mb-1 text-right">
        <AutoRefresh seconds={30} />
      </div>
      <CustomerTable rows={rows} />
    </Page>
  );
}
