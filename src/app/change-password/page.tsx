import { redirect } from "next/navigation";
import { Bi } from "@/components/ui";
import { Page } from "@/components/page";
import { currentUser } from "@/server/session";
import { ChangePasswordForm } from "./form";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const u = await currentUser();
  if (!u) redirect("/login");
  return (
    <Page title={<Bi en="Set a new password" hi="नया पासवर्ड बनाएँ" />} back={u.mustChangePassword ? undefined : "/"}>
      <ChangePasswordForm forced={u.mustChangePassword} />
    </Page>
  );
}
