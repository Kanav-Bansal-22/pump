import { Bi, Page } from "@/components/ui";
import { EntryForm, type KindOption } from "@/components/entry-form";
import { pool } from "@/server/db";
import { ENTRY_KINDS, entryDates, expenseAccounts, type EntryKind } from "@/server/money/service";
import { requireUser } from "@/server/session";

/** Server wrapper shared by the four entry screens. */
export async function EntryPage({ titleEn, titleHi, kinds }: { titleEn: string; titleHi: string; kinds: EntryKind[] }) {
  const user = await requireUser();
  const allowed = kinds.filter((k) => user.permissions.includes(ENTRY_KINDS[k].perm) && (!ENTRY_KINDS[k].ownerOnly || user.role === "OWNER"));
  const c = await pool().connect();
  try {
    const dates = await entryDates(c);
    const expenses = await expenseAccounts(c);
    const modes = (await c.query("SELECT code, name_en, name_hi, allowed_on_receipt, allowed_on_payment FROM payment_modes WHERE active ORDER BY sort_order")).rows;
    const options: KindOption[] = allowed.map((k) => {
      const d = ENTRY_KINDS[k];
      return {
        kind: k,
        en: d.en,
        hi: d.hi,
        party: d.party,
        dir: d.dir,
        modes: d.dir === "CREDIT" ? [] : modes.filter((m) => (d.dir === "IN" ? m.allowed_on_receipt : m.allowed_on_payment)).filter((m) => k !== "BANK_DEPOSIT" || m.code === "CASH").map((m) => ({ code: m.code, en: m.name_en, hi: m.name_hi })),
      };
    });
    return (
      <Page title={<Bi en={titleEn} hi={titleHi} />} back="/">
        {options.length ? (
          <EntryForm options={options} dates={dates} expenses={expenses} canSeeBalance={user.permissions.includes("customer.view_balance")} />
        ) : (
          <p>You are not allowed to make these entries.</p>
        )}
      </Page>
    );
  } finally {
    c.release();
  }
}
