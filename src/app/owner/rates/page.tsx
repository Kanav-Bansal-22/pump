import { Bi, Card, Page } from "@/components/ui";
import { niceDate } from "@/lib/format";
import { pool } from "@/server/db";
import { currentBusinessDate, getRates } from "@/server/meters/service";
import { requireUser } from "@/server/session";
import { RateForm } from "./rate-form";

export const dynamic = "force-dynamic";

export default async function RatesPage() {
  await requireUser("price.set");
  const c = await pool().connect();
  try {
    const date = await currentBusinessDate(c);
    const rates = await getRates(c, date);
    return (
      <Page title={<Bi en="Today's rates" hi="आज का रेट" />} back="/">
        <Card className="mb-4">
          <div className="text-base">
            Rates for business day <b>{niceDate(date)}</b> (from the 8 AM change).
          </div>
          <div className="text-sm opacity-80">8 बजे के बदलाव के बाद का रेट डालें।</div>
        </Card>
        <div className="space-y-4">
          {rates.map((r) => (
            <RateForm key={r.code} fuel={{ code: r.code, nameEn: r.name_en, nameHi: r.name_hi, short: r.short }} current={r.rate} setBy={r.set_by} />
          ))}
        </div>
      </Page>
    );
  } finally {
    c.release();
  }
}
