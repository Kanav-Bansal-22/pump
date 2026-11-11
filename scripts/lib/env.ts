import { existsSync, readFileSync } from "node:fs";

export type PumpEnv = {
  DB_HOST: string;
  DB_PORT: string;
  DB_NAME: string;
  DB_MIGRATOR_PASSWORD: string;
  DB_APP_PASSWORD: string;
  DB_BACKUP_PASSWORD: string;
  SESSION_SECRET: string;
};

/** Reads .env from the project root (process.env values take precedence). */
export function loadEnv(): PumpEnv {
  const file: Record<string, string> = {};
  if (existsSync(".env")) {
    for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) file[m[1]] = m[2];
    }
  }
  const get = (k: keyof PumpEnv) => {
    const v = process.env[k] ?? file[k];
    if (!v) throw new Error(`${k} is missing. Run "npm run db:setup" first.`);
    return v;
  };
  return {
    DB_HOST: get("DB_HOST"),
    DB_PORT: get("DB_PORT"),
    DB_NAME: get("DB_NAME"),
    DB_MIGRATOR_PASSWORD: get("DB_MIGRATOR_PASSWORD"),
    DB_APP_PASSWORD: get("DB_APP_PASSWORD"),
    DB_BACKUP_PASSWORD: get("DB_BACKUP_PASSWORD"),
    SESSION_SECRET: get("SESSION_SECRET"),
  };
}
