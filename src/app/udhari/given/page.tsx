import { EntryPage } from "../../entry-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return <EntryPage titleEn="Udhari given" titleHi="उधारी दी" kinds={["CREDIT_SALE"]} />;
}
