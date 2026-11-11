import { EntryPage } from "../entry-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return <EntryPage titleEn="Lube / other receipt" titleHi="लुब्रिकेंट / अन्य आमदनी" kinds={["LUBE_SALE", "OTHER_INCOME", "LOAN_RECEIVED", "OWNER_CAPITAL"]} />;
}
