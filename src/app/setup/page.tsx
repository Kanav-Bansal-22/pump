import { redirect } from "next/navigation";
import { Bi, Card, Page } from "@/components/ui";
import { firstRun } from "@/server/session";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

/** First run only: create the owner's account. Disappears once any user exists. */
export default async function SetupPage() {
  if (!(await firstRun())) redirect("/login");
  return (
    <Page title={<Bi en="First-time setup" hi="पहली बार सेटअप" />}>
      <Card className="mb-4">
        <p className="text-base">
          Create the <b>owner</b> account. Only the owner can add staff, change settings and lock days.
        </p>
        <p className="mt-1 text-base opacity-80">मालिक का खाता बनाएँ। केवल मालिक कर्मचारी जोड़ सकते हैं।</p>
      </Card>
      <SetupForm />
    </Page>
  );
}
