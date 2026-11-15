import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Panel, Shell } from "@/components/ui";
import { niceDate } from "@/lib/format";
import { pool, q } from "@/server/db";
import { D } from "@/server/money";
import { closingBusinessDate, getBoard, getRates, openTests } from "@/server/meters/service";
import { catchUpFrom, customerList, entryDates, getDayBalance, goLiveDate } from "@/server/money/service";
import { requireUser } from "@/server/session";
import { DayBook } from "./register/day-book";
import { DaySummary } from "./register/day-summary";
import { NewCustomer } from "./register/new-customer";
import { NozzleClosing } from "./register/nozzle-closing";
import { Expenses } from "./register/expenses";
import { Income } from "./register/income";
import { Rates } from "./register/rates";
import { TestingFuel } from "./register/testing-fuel";
import { Udhari } from "./register/udhari";

export const dynamic = "force-dynamic";

/** The register: everything for the day on one page. */
export default async function RegisterPage() {
  const user = await requireUser();
  if (user.homeView === "simple") redirect("/staff"); // employee phones open the two-option page
  const isOwner = user.role === "OWNER";
  const c = await pool().connect();
  try {
    const site = (await c.query("SELECT name FROM sites WHERE active LIMIT 1")).rows[0];
    if (!site) {
      return (
        <Shell user={user}>
          <Panel title="Set up the pump first">
            {isOwner ? <Link href="/owner/setup" className="text-accent underline">Open pump setup →</Link> : "Ask the owner to set up the pump."}
          </Panel>
        </Shell>
      );
    }
    const dates = await entryDates(c);
    const closingDate = await closingBusinessDate(c);
    const board = await getBoard(c);
    const ratesToday = await getRates(c, dates.today);
    const ratesClosing = closingDate === dates.today ? ratesToday : await getRates(c, closingDate);
    const customers = await customerList(c);
    const earliest = isOwner ? (await catchUpFrom(c, dates.today)).date : null;
    const tests = await openTests(c);
    const testLitres: Record<string, string> = {};
    for (const t of tests.filter((x) => !x.voided)) testLitres[t.nozzleId] = new D(testLitres[t.nozzleId] ?? 0).plus(t.litres).toFixed(3);
    const closingStatus = (await c.query("SELECT status FROM business_days WHERE business_date = $1", [closingDate])).rows[0]?.status ?? "OPEN";
    const live = await goLiveDate(c);
    const beforeGoLive = !!live && closingDate <= live; // go-live morning: the starting readings closed it
    const summaryDate = closingStatus === "LOCKED" || beforeGoLive ? dates.today : closingDate;
    const summary = await getDayBalance(c, summaryDate);
    const bookToday = summaryDate === dates.today ? summary : await getDayBalance(c, dates.today);
    const snap = summary.status === "LOCKED" ? (await c.query("SELECT integrity_code FROM day_snapshots WHERE business_date = $1 AND kind = 'LOCK'", [summaryDate])).rows[0] : null;
    const backupOld = isOwner
      ? ((await q<{ h: string | null }>("SELECT (EXTRACT(EPOCH FROM now() - max(finished_at)) / 3600)::int::text AS h FROM backup_log WHERE ok"))[0]?.h ?? "999")
      : null;

    const strip = <T extends { _site?: unknown; _fuel?: unknown }>(b: T) => {
      const { _site, _fuel, ...rest } = b;
      void _site;
      void _fuel;
      return rest;
    };

    return (
      <Shell active="register" user={user} pump={site.name} wide>
        <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-lg font-bold">
            Register · <span className="text-accent">{niceDate(dates.today)}</span>
          </h1>
          {dates.yesterday && <span className="text-sm text-muted">Closing of {niceDate(dates.yesterday)} still open (until 11 AM)</span>}
          <AutoRefresh />

          {backupOld && Number(backupOld) > 26 && (
            <Link href="/owner/backups" className="text-sm font-semibold text-red-700 underline">
              ⚠ No backup for {Number(backupOld) > 900 ? "a long time" : `${backupOld} h`}: back up now
            </Link>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          {/* left: what happens during the day */}
          <div className="min-w-0 space-y-3">
            <Rates date={dates.today} rates={ratesToday.map((r) => ({ code: r.code, short: r.short, name: r.name_en, rate: r.rate, setBy: r.set_by }))} canSet={user.permissions.includes("price.set")} />
            <Udhari customers={customers} dates={dates} earliest={earliest} />
            <NewCustomer dates={dates} />
            <Expenses dates={dates} isOwner={isOwner} />
            <Income dates={dates} />
          </div>

          {/* right: closing of the day */}
          <div className="min-w-0 space-y-3">
            <NozzleClosing
              closingDate={closingDate}
              locked={closingStatus === "LOCKED" || beforeGoLive}
              rows={board.map((b) => ({
                nozzleId: b.nozzleId,
                station: b.stationName,
                label: b.label,
                fuel: b.fuelCode,
                active: b.active,
                hasBaseline: b.hasBaseline,
                done: b.doneForClosingDate,
                lastPointId: b.last?.pointId ?? null,
                lastReading: b.last?.reading ?? null,
                lastDate: b.last?.businessDate ?? null,
                flags: b.openFlags,
              }))}
              rates={Object.fromEntries(ratesClosing.map((r) => [r.code, r.rate]))}
              tests={testLitres}
            />
            <TestingFuel nozzles={board.filter((b) => b.active && b.hasBaseline).map((b) => ({ id: b.nozzleId, label: b.label, station: b.stationName }))} tests={tests} />
            <DaySummary
              summary={
                isOwner || summary.status === "LOCKED"
                  ? strip(summary)
                  : // blind count: the expected cash never leaves the server for staff before the day is ended
                    { ...strip(summary), expectedCash: "", difference: null, withinTolerance: null, counted: null }
              }
              isOwner={isOwner}
              integrityCode={snap?.integrity_code ?? null}
              pump={site.name}
            />
            <DayBook
              books={[strip(summary), ...(summaryDate !== dates.today ? [strip(bookToday)] : [])].map((b) => ({ date: b.date, status: b.status, entries: b.entries }))}
              isOwner={isOwner}
            />
          </div>
        </div>
      </Shell>
    );
  } finally {
    c.release();
  }
}
