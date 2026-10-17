import { randomBytes } from "node:crypto";
import { createPgDb } from "./pg";
import { createPgliteDb } from "./pglite";
import { migrate } from "./migrate";
import type { Db } from "./db";

export type Engine = "pglite" | "postgres";

/** PGlite always; real Postgres too when TEST_DATABASE_URL is set (CI sets it; locally: postgres://user@localhost:5432/dbname). */
export const engines = (): Engine[] => (process.env["TEST_DATABASE_URL"] ? ["pglite", "postgres"] : ["pglite"]);

export interface TestDb { db: Db; engine: Engine; close: () => Promise<void> }

/** A fresh, isolated database with NO migrations applied, for tests that need to apply them one at a time. */
export async function createBlankTestDb(engine: Engine): Promise<TestDb> {
  if (engine === "pglite") {
    const db = await createPgliteDb();
    return { db, engine, close: () => db.close() };
  }
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  const schema = `t_${randomBytes(6).toString("hex")}`;
  const admin = createPgDb({ connectionString: url, max: 1 });
  await admin.exec(`create schema ${schema}`);
  const db = createPgDb({ connectionString: url, schema, max: 5 });
  return { db, engine, close: async () => { await db.close(); await admin.exec(`drop schema ${schema} cascade`); await admin.close(); } };
}

/** A fresh, migrated, isolated database. Postgres gets its own schema (dropped on close). */
export async function createTestDb(engine: Engine): Promise<TestDb> {
  if (engine === "pglite") {
    const db = await createPgliteDb();
    await migrate(db);
    return { db, engine, close: () => db.close() };
  }
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  const schema = `t_${randomBytes(6).toString("hex")}`;
  const admin = createPgDb({ connectionString: url, max: 1 });
  await admin.exec(`create schema ${schema}`);
  const db = createPgDb({ connectionString: url, schema, max: 20 });
  await migrate(db);
  return {
    db, engine,
    close: async () => { await db.close(); await admin.exec(`drop schema ${schema} cascade`); await admin.close(); }
  };
}
