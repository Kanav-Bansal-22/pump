import { EntryPage } from "../entry-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <EntryPage
      titleEn="Payment / expense"
      titleHi="भुगतान / खर्च"
      kinds={["EXPENSE", "SUPPLIER_PAYMENT", "BANK_DEPOSIT", "SALARY", "STAFF_ADVANCE", "OWNER_DRAWING", "LOAN_REPAYMENT"]}
    />
  );
}
