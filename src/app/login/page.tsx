import { redirect } from "next/navigation";
import { Bi } from "@/components/ui";
import { Page } from "@/components/page";
import { currentUser, firstRun } from "@/server/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await firstRun()) redirect("/setup");
  if (await currentUser()) redirect("/");
  return (
    <Page title={<Bi en="Log in" hi="लॉगिन" />}>
      <LoginForm />
    </Page>
  );
}
