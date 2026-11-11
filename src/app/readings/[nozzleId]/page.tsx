import { notFound } from "next/navigation";
import { Bi, Page } from "@/components/ui";
import { pool } from "@/server/db";
import { getBoard } from "@/server/meters/service";
import { requireUser } from "@/server/session";
import { ReadingForm } from "./reading-form";

export const dynamic = "force-dynamic";

export default async function EnterReading({ params }: PageProps<"/readings/[nozzleId]">) {
  await requireUser("meter.enter");
  const { nozzleId } = await params;
  const c = await pool().connect();
  const board = await getBoard(c).finally(() => c.release());
  const n = board.find((b) => b.nozzleId === nozzleId);
  if (!n) notFound();
  return (
    <Page title={<Bi en={`${n.stationName} · ${n.label}`} hi="मीटर रीडिंग" />} back="/readings">
      <ReadingForm nozzle={n} />
    </Page>
  );
}
