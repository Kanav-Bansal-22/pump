import Link from "next/link";
import { Page } from "@/components/page";
import { Panel } from "@/components/ui";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

const ITEMS = [
  { href: "/owner/import", en: "Import old udhari", hi: "पुराना उधारी डालें", note: "Excel from the old register, checked against its total" },
  { href: "/owner/baseline", en: "Starting readings", hi: "शुरुआती रीडिंग", note: "each nozzle's meter at go-live (once)" },
  { href: "/owner/users", en: "Staff logins", hi: "कर्मचारी लॉगिन", note: "add staff, reset password, disable, sign out lost phone" },
  { href: "/owner/backups", en: "Backups", hi: "बैकअप", note: "back up now, download a copy to your phone" },
  { href: "/owner/setup", en: "Pump setup", hi: "पंप सेटअप", note: "pump name, stations and nozzle names" },
  { href: "/change-password", en: "Change my password", hi: "पासवर्ड बदलें", note: "" },
];

export default async function SettingsPage() {
  await requireUser("settings.manage");
  return (
    <Page title="Settings · सेटिंग" active="settings">
      <Panel title="Owner tools">
        <table className="reg">
          <tbody>
            {ITEMS.map((i) => (
              <tr key={i.href} className="hover:bg-soft">
                <td className="w-56">
                  <Link href={i.href} className="font-semibold text-accent hover:underline">
                    {i.en}
                  </Link>{" "}
                  <span className="text-xs text-muted">· {i.hi}</span>
                </td>
                <td className="text-sm text-muted">{i.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </Page>
  );
}
