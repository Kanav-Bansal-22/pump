import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { BigLink, Bi, Card, Page } from "@/components/ui";
import { q } from "@/server/db";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

async function backupWarning(): Promise<string | null> {
  const r = await q<{ last: Date | null }>("SELECT max(finished_at) AS last FROM backup_log WHERE ok");
  const last = r[0]?.last;
  if (!last) return "No backup has been taken yet.";
  const h = (Date.now() - new Date(last).getTime()) / 3600000;
  return h > 26 ? `Last backup was ${Math.floor(h)} hours ago.` : null;
}

export default async function Home() {
  const user = await requireUser();
  const isOwner = user.role === "OWNER";
  const warn = isOwner ? await backupWarning() : null;
  return (
    <Page title={<Bi en={`Namaste, ${user.name}`} hi={isOwner ? "मालिक" : "कर्मचारी"} />}>
      {warn && (
        <Link href="/owner/backups" className="mb-4 block rounded-2xl bg-red-100 p-4 text-base font-semibold text-red-900">
          🔴 {warn} Tap to back up. / बैकअप लें।
        </Link>
      )}
      <div className="grid grid-cols-2 gap-3">
        <BigLink href="/readings">
          <Bi en="Nozzle reading" hi="मीटर रीडिंग" />
        </BigLink>
        <BigLink href="/udhari/given">
          <Bi en="Udhari given" hi="उधारी दी" />
        </BigLink>
        <BigLink href="/udhari/received">
          <Bi en="Udhari received" hi="उधारी मिली" />
        </BigLink>
        <BigLink href="/payments">
          <Bi en="Payment / expense" hi="भुगतान / खर्च" />
        </BigLink>
        <BigLink href="/receipts">
          <Bi en="Lube / other sale" hi="लुब्रिकेंट / अन्य बिक्री" />
        </BigLink>
        <BigLink href="/close-day">
          <Bi en="Close day / cash count" hi="दिन बंद / नकद गिनती" />
        </BigLink>
      </div>

      {isOwner && (
        <Card className="mt-6">
          <h2 className="mb-3 text-lg font-bold">
            <Bi en="Owner" hi="मालिक" />
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <BigLink href="/owner/day">
              <Bi en="Day sheet (sales)" hi="दिन का हिसाब" />
            </BigLink>
            <BigLink href="/udhari">
              <Bi en="Udhari list" hi="उधारी खाता" />
            </BigLink>
            <BigLink href="/owner/import">
              <Bi en="Import old udhari" hi="पुराना उधारी डालें" />
            </BigLink>
            <BigLink href="/owner/rates">
              <Bi en="Today's rates" hi="आज का रेट" />
            </BigLink>
            <BigLink href="/owner/backups">
              <Bi en="Backups" hi="बैकअप" />
            </BigLink>
            <BigLink href="/owner/baseline">
              <Bi en="Starting readings" hi="शुरुआती रीडिंग" />
            </BigLink>
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
