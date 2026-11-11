import { Bi, Card } from "@/components/ui";
import { Page } from "@/components/page";
import { niceTime, num } from "@/lib/format";
import { pool } from "@/server/db";
import { getBoard } from "@/server/meters/service";
import { requireUser } from "@/server/session";
import { BaselineForm } from "./baseline-form";

export const dynamic = "force-dynamic";

/** Go-live: the owner types each nozzle's current totalizer once. Afterwards it is read-only. */
export default async function BaselinePage() {
  await requireUser("settings.manage");
  const c = await pool().connect();
  const board = await getBoard(c).finally(() => c.release());
  return (
    <Page title={<Bi en="Starting readings (go-live)" hi="शुरुआती रीडिंग" />} back="/settings">
      <Card className="mb-4">
        <p className="text-base">
          Enter each nozzle&apos;s meter reading <b>once</b>, on go-live day, at the 8 AM closing. Staff readings carry on from
          these. They cannot be changed later, only corrected with a reason.
        </p>
        <p className="mt-1 text-sm opacity-80">हर नोज़ल की रीडिंग केवल एक बार, शुरू करने के दिन।</p>
      </Card>
      <div className="space-y-3">
        {board.map((b) => (
          <Card key={b.nozzleId}>
            <div className="mb-2 text-lg font-bold">
              {b.stationName} · {b.label}
            </div>
            {b.hasBaseline && b.last ? (
              <div className="text-base">
                ✅ Started. Last reading <span className="font-mono">{num(b.last.reading)}</span>
                <span className="text-sm text-muted"> · {niceTime(b.last.at)}</span>
              </div>
            ) : (
              <BaselineForm nozzleId={b.nozzleId} />
            )}
          </Card>
        ))}
      </div>
    </Page>
  );
}
