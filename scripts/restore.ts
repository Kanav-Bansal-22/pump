/**
 * Restores a backup into a new, empty database (moving to another laptop, or after a disk failure):
 *
 *   npm run db:restore -- backups\nightly\pump_prod_20261120-020000_nightly.dump
 *   npm run db:restore -- <file.dump> pump_prod        (default target: pump_prod)
 *
 * Asks for the postgres superuser password (hidden, never stored). Never overwrites a database that
 * already has data. Afterwards set DB_NAME in .env to the target and run `npm run build`.
 * See docs/MOVE_TO_NEW_LAPTOP.md.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv } from "./lib/env";
import { promptHidden } from "./lib/prompt";
import { restoreBackup } from "./lib/restore";

async function main() {
  const file = process.argv[2];
  const target = process.argv[3] ?? "pump_prod";
  if (!file) {
    console.error("Which backup? npm run db:restore -- <file.dump> [database]");
    process.exit(2);
  }
  const env = loadEnv();
  const pwFile = process.env.PG_SUPERPASS_FILE;
  const superPassword = pwFile ? readFileSync(pwFile, "utf8").trim().split(/\r?\n/).pop()!.trim() : await promptHidden("postgres superuser password: ");
  const r = await restoreBackup({
    file: resolve(file),
    target,
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    superPassword,
    migratorPassword: env.DB_MIGRATOR_PASSWORD,
  });
  console.log("");
  for (const [k, v] of Object.entries(r.counts)) console.log(`  ${k.padEnd(18)} ${v}`);
  console.log(`  meter chains       ${r.chainProblems === 0 ? "OK" : `${r.chainProblems} PROBLEM(S)`}${r.headsMatch === true ? " · match the backup record" : r.headsMatch === false ? " · DO NOT match the backup record" : ""}`);
  if (r.migrationsApplied.length) console.log(`  updated to the current app version (${r.migrationsApplied.length} migration(s))`);
  if (r.chainProblems > 0 || r.headsMatch === false) {
    console.error("\nWARNING: the restored meter readings do not verify. Do not use this database; try another backup.");
    process.exit(1);
  }
  console.log(`\nRestored into ${target}. Next: set DB_NAME=${target} in .env, then npm run build.`);
}

main().catch((e) => {
  console.error("Restore failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
