import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { INT8_OID, bindParams, parseInt8, type Db, type Queryable, type Row } from "./db";

const parsers = { [INT8_OID]: parseInt8 };

function wrap(client: Pick<PGlite, "query" | "exec">): Queryable {
  return {
    async query<T = Row>(sql: string, params?: readonly unknown[]) {
      const res = await client.query(sql, bindParams(params), { parsers });
      return res.rows as T[];
    },
    async exec(sql: string) { await client.exec(sql); }
  };
}

/** Postgres in WebAssembly. Pass a directory to keep data between runs; omit it for a throwaway in-memory database. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  // Loaded only when asked for, and natively rather than through the bundler: PGlite finds its WebAssembly files relative to
  // its own location, which bundling breaks. A production build that uses real Postgres never loads it at all.
  const { PGlite: Lite } = await import(/* webpackIgnore: true */ "@electric-sql/pglite");
  if (dataDir) mkdirSync(dirname(dataDir), { recursive: true });
  const lite = dataDir ? new Lite(dataDir) : new Lite();
  await lite.waitReady;
  return {
    ...wrap(lite),
    tx: (fn) => lite.transaction((t) => fn(wrap(t))),
    close: () => lite.close()
  };
}
