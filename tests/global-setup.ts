/**
 * Starts a private, throwaway PostgreSQL 16 (embedded-postgres) for the test run, provisions the
 * same restricted roles as production, and applies all migrations to pump_test.
 * Nothing touches the real installation or real data.
 */
import EmbeddedPostgres from "embedded-postgres";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { provision } from "../scripts/lib/provision";
import { migrate } from "../scripts/migrate";

const PORT = 55432;
const SUPER_PW = "test_super_pw";
export const TEST_PASSWORDS = { pump_migrator: "test_migrator_pw", pump_app: "test_app_pw", pump_backup: "test_backup_pw" };

let pg: EmbeddedPostgres | undefined;

export default async function setup(project: TestProject) {
  const dir = join(process.cwd(), ".test-pg");
  rmSync(dir, { recursive: true, force: true });
  pg = new EmbeddedPostgres({
    databaseDir: dir,
    port: PORT,
    user: "postgres",
    password: SUPER_PW,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await provision({
    host: "127.0.0.1",
    port: PORT,
    superUser: "postgres",
    superPassword: SUPER_PW,
    // pump_test: shared by most tests. pump_test_clean: pristine (no users, no site) for first-run tests.
    // pump_test_meters: one pump layout, used by the meter tests.
    // pump_test_backup: backup -> restore round trip.
    // pump_test_money: one full register day (entries, count, lock).
    // pump_test_import: opening-balance import.
    // pump_test_staff: employee UPI totals and repeat-entry protection.
    databases: ["pump_test", "pump_test_clean", "pump_test_meters", "pump_test_backup", "pump_test_money", "pump_test_import", "pump_test_reports", "pump_test_staff"],
    passwords: TEST_PASSWORDS,
  });
  for (const database of ["pump_test", "pump_test_clean", "pump_test_meters", "pump_test_backup", "pump_test_money", "pump_test_import", "pump_test_reports", "pump_test_staff"])
    await migrate({ host: "127.0.0.1", port: PORT, migratorPassword: TEST_PASSWORDS.pump_migrator, database }, () => {});
  project.provide("db", { host: "127.0.0.1", port: PORT, database: "pump_test", superPassword: SUPER_PW, ...TEST_PASSWORDS });

  return async () => {
    await pg?.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    db: {
      host: string;
      port: number;
      database: string;
      superPassword: string;
      pump_migrator: string;
      pump_app: string;
      pump_backup: string;
    };
  }
}
