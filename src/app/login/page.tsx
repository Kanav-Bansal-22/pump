import { redirect } from "next/navigation";
import { Bi, Page } from "@/components/ui";
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
