import { Bi, Card } from "@/components/ui";
import { Page } from "@/components/page";
import { inr, niceDate } from "@/lib/format";
import { pool } from "@/server/db";
import { currentBusinessDate } from "@/server/meters/service";
import { requireUser } from "@/server/session";
import { ImportWizard } from "./wizard";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requireUser("import.run");
  const c = await pool().connect();
  try {
    const today = await currentBusinessDate(c);
    const batches = (
      await c.query(
        `SELECT b.file_name, b.status, b.row_count, b.file_total::text AS total, b.opening_date::text AS d, b.confirmed_at, u.name AS by
           FROM import_batches b JOIN users u ON u.id = COALESCE(b.confirmed_by, b.created_by)
          WHERE b.status = 'CONFIRMED' ORDER BY b.confirmed_at DESC`,
      )
    ).rows;
    return (
      <Page title={<Bi en="Import old udhari" hi="पुराना उधारी खाता डालें" />} back="/settings">
        <Card className="mb-4">
          <ol className="list-decimal space-y-1 pl-6 text-base">
            <li>
              <a href="/api/owner/import" className="text-brand underline">
                Download the Excel template
              </a>{" "}
              and fill one row per customer from the old register: name, phone, address, <b>amount they owe</b> (minus for an advance), remarks.
            </li>
            <li>Upload it below. Nothing is saved until you confirm.</li>
            <li>Check the preview, then type the <b>total from the old register</b>. It must match the file exactly.</li>
          </ol>
          <p className="mt-2 text-sm opacity-80">पुराने रजिस्टर से हर ग्राहक का बकाया भरें, फ़ाइल अपलोड करें, रजिस्टर का कुल लिखकर पक्का करें।</p>
        </Card>
        <ImportWizard today={today} />
        {batches.length > 0 && (
          <Card className="mt-4">
            <h2 className="mb-2 text-lg font-bold">Done imports</h2>
            {batches.map((b, i) => (
              <div key={i} className="border-b border-line py-2 text-base last:border-0">
                ✅ {b.file_name} · {b.row_count} customers · {inr(b.total)} · as on {niceDate(b.d)}
                <div className="text-sm text-muted">
                  by {b.by} · {new Date(b.confirmed_at).toLocaleString("en-IN")}
                </div>
              </div>
            ))}
          </Card>
        )}
      </Page>
    );
  } finally {
    c.release();
  }
}
