import { Client } from "pg";

export type ProvisionInput = {
  host: string;
  port: number;
  superUser: string;
  superPassword: string;
  databases: string[];
  /** Password to set per login role; roles missing from this map keep their current password. */
  passwords: Partial<Record<"pump_migrator" | "pump_app" | "pump_backup", string>>;
};

const LOGIN_ROLES = ["pump_migrator", "pump_app", "pump_backup"] as const;

/**
 * Creates roles and databases with least-privilege defaults. Idempotent.
 *  pump_owner    NOLOGIN, owns every object (so the app role can never ALTER/DROP them)
 *  pump_migrator LOGIN, member of pump_owner, used only to run migrations
 *  pump_app      LOGIN, receives only per-table grants from migrations (no DELETE anywhere)
 *  pump_backup   LOGIN, read-only (pg_dump)
 */
export async function provision(p: ProvisionInput): Promise<void> {
  const su = new Client({ host: p.host, port: p.port, user: p.superUser, password: p.superPassword, database: "postgres" });
  await su.connect();
  try {
    const roleExists = async (r: string) =>
      (await su.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [r])).rowCount === 1;
    if (!(await roleExists("pump_owner"))) await su.query("CREATE ROLE pump_owner NOLOGIN");
    for (const r of LOGIN_ROLES) {
      const pw = p.passwords[r];
      const exists = await roleExists(r);
      if (!exists && !pw) throw new Error(`Role ${r} does not exist and no password was given`);
      if (pw) {
        if (!/^[A-Za-z0-9_-]+$/.test(pw)) throw new Error("Generated passwords must be base64url");
        await su.query(exists ? `ALTER ROLE ${r} WITH LOGIN PASSWORD '${pw}'` : `CREATE ROLE ${r} LOGIN PASSWORD '${pw}'`);
      }
    }
    await su.query("GRANT pump_owner TO pump_migrator");
    await su.query("ALTER ROLE pump_app SET statement_timeout = '30s'");

    for (const db of p.databases) {
      if (!/^[a-z_]+$/.test(db)) throw new Error(`Bad database name ${db}`);
      const exists = (await su.query("SELECT 1 FROM pg_database WHERE datname = $1", [db])).rowCount === 1;
      if (!exists) await su.query(`CREATE DATABASE ${db} OWNER pump_owner ENCODING 'UTF8' TEMPLATE template0`);
      await su.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
      await su.query(`GRANT CONNECT ON DATABASE ${db} TO pump_migrator, pump_app, pump_backup`);
      await su.query(`ALTER DATABASE ${db} SET timezone = 'Asia/Kolkata'`);

      const c = new Client({ host: p.host, port: p.port, user: p.superUser, password: p.superPassword, database: db });
      await c.connect();
      try {
        await c.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
        await c.query("ALTER SCHEMA public OWNER TO pump_owner");
        await c.query("GRANT USAGE ON SCHEMA public TO pump_app, pump_backup");
        await c.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
      } finally {
        await c.end();
      }
    }
  } finally {
    await su.end();
  }
}
