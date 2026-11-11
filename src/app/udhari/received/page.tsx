import { EntryPage } from "../../entry-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return <EntryPage titleEn="Udhari received" titleHi="उधारी मिली" kinds={["CUSTOMER_REPAYMENT"]} />;
}
