import { LogoutButton } from "@/components/logout-button";
import { BigLink, Bi, Card, Page } from "@/components/ui";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

const SOON = <span className="text-sm">(coming next / जल्द)</span>;

export default async function Home() {
  const user = await requireUser();
  const isOwner = user.role === "OWNER";
  return (
    <Page title={<Bi en={`Namaste, ${user.name}`} hi={isOwner ? "मालिक" : "कर्मचारी"} />}>
      <div className="grid grid-cols-2 gap-3">
        <BigLink href="/readings" disabled>
          <span>
            <Bi en="Nozzle reading" hi="मीटर रीडिंग" /> {SOON}
          </span>
        </BigLink>
        <BigLink href="/udhari/given" disabled>
          <span>
            <Bi en="Udhari given" hi="उधारी दी" /> {SOON}
          </span>
        </BigLink>
        <BigLink href="/udhari/received" disabled>
          <span>
            <Bi en="Udhari received" hi="उधारी मिली" /> {SOON}
          </span>
        </BigLink>
        <BigLink href="/payments" disabled>
          <span>
            <Bi en="Payment / expense" hi="भुगतान / खर्च" /> {SOON}
          </span>
        </BigLink>
        <BigLink href="/receipts" disabled>
          <span>
            <Bi en="Lube / other sale" hi="लुब्रिकेंट / अन्य बिक्री" /> {SOON}
          </span>
        </BigLink>
        <BigLink href="/close-day" disabled>
          <span>
            <Bi en="Cash count (day end)" hi="नकद गिनती" /> {SOON}
          </span>
        </BigLink>
      </div>

      {isOwner && (
        <Card className="mt-6">
          <h2 className="mb-3 text-lg font-bold">
            <Bi en="Owner" hi="मालिक" />
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <BigLink href="/owner/setup">
              <Bi en="Pump setup" hi="पंप सेटअप" />
            </BigLink>
            <BigLink href="/owner/users">
              <Bi en="Staff logins" hi="कर्मचारी लॉगिन" />
            </BigLink>
          </div>
        </Card>
      )}

      <div className="mt-8">
        <LogoutButton />
      </div>
    </Page>
  );
}
