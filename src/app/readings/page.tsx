import Link from "next/link";
import { Bi, Card, Page } from "@/components/ui";
import { niceDate, niceTime, num } from "@/lib/format";
import { pool } from "@/server/db";
import { getBoard } from "@/server/meters/service";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function ReadingsBoard() {
  await requireUser("meter.enter");
  const c = await pool().connect();
  const board = await getBoard(c).finally(() => c.release());
  const closingDate = board[0]?.closingDate;
  const stations = [...new Set(board.map((b) => b.stationName))];
  return (
    <Page title={<Bi en="Nozzle readings" hi="मीटर रीडिंग" />} back="/">
      {closingDate && (
        <Card className="mb-4">
          <div className="text-base">
            A reading saved now is the <b>closing for {niceDate(closingDate)}</b>.
          </div>
          <div className="text-sm opacity-80">अभी की रीडिंग {niceDate(closingDate)} की क्लोज़िंग होगी।</div>
        </Card>
      )}
      {stations.map((s) => (
        <section key={s} className="mb-5">
          <h2 className="mb-2 text-lg font-bold">{s}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {board
              .filter((b) => b.stationName === s)
              .map((b) => {
                const disabled = !b.active || !b.hasBaseline;
                const body = (
                  <div className={`rounded-2xl border-2 p-4 ${b.doneForClosingDate ? "border-green-600" : "border-line"} bg-surface`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-bold">{b.label}</span>
                      <span
                        className="rounded-full px-3 py-1 text-sm font-semibold text-white"
                        style={{ background: b.fuelCode === "PETROL" ? "#16a34a" : "#2563eb" }}
                      >
                        {b.fuelCode === "PETROL" ? "Petrol" : "Diesel"}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-muted">Last reading / पिछली रीडिंग</div>
                    <div className="font-mono text-2xl">{b.last ? num(b.last.reading) : "—"}</div>
                    {b.last && (
                      <div className="text-sm text-muted">
                        {niceTime(b.last.at)} · {b.last.byName}
                      </div>
                    )}
                    <div className="mt-2 text-base font-semibold">
                      {!b.active ? (
                        <span className="text-muted">Switched off / बंद</span>
                      ) : !b.hasBaseline ? (
                        <span className="text-orange-600">Owner must enter the starting reading</span>
                      ) : b.doneForClosingDate ? (
                        <span className="text-green-700">✅ Done for {niceDate(b.closingDate)}</span>
                      ) : (
                        <span className="text-brand">Tap to enter reading → / रीडिंग डालें</span>
                      )}
                      {b.openFlags > 0 && <div className="text-sm text-orange-600">🟡 {b.openFlags} waiting for owner review</div>}
                    </div>
                  </div>
                );
                return disabled || b.doneForClosingDate ? (
                  <div key={b.nozzleId}>{body}</div>
                ) : (
                  <Link key={b.nozzleId} href={`/readings/${b.nozzleId}`} className="block active:scale-[0.99]">
                    {body}
                  </Link>
                );
              })}
          </div>
        </section>
      ))}
    </Page>
  );
}
