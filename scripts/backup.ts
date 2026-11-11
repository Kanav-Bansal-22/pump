/**
 * Takes a backup now (used by the Windows scheduled tasks and by hand):
 *   npm run backup                 -> NIGHTLY backup of DB_NAME
 *   npm run backup -- HOURLY
 *   npm run backup -- MANUAL pump_demo
 * Exit code 0 only when the backup file was written, verified readable, hashed and logged.
 */
import { takeBackup, type BackupKind } from "../src/server/ops/backup";

const kind = (process.argv[2]?.toUpperCase() ?? "NIGHTLY") as BackupKind;
if (!["HOURLY", "NIGHTLY", "MANUAL", "PREMIGRATION"].includes(kind)) {
  console.error("kind must be HOURLY, NIGHTLY, MANUAL or PREMIGRATION");
  process.exit(2);
}
takeBackup(kind, process.argv[3])
  .then((r) => {
    if (!r.ok) {
      console.error(`BACKUP FAILED: ${r.error}`);
      process.exit(1);
    }
    console.log(`backup ok: ${r.file} (${r.size} bytes, sha256 ${r.sha256?.slice(0, 16)}..., chain problems: ${r.chainProblems})`);
  })
  .catch((e) => {
    console.error(`BACKUP FAILED: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
