import { PGlite } from "@electric-sql/pglite";
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
  const lite = dataDir ? new PGlite(dataDir) : new PGlite();
  await lite.waitReady;
  return {
    ...wrap(lite),
    tx: (fn) => lite.transaction((t) => fn(wrap(t))),
    close: () => lite.close()
  };
}
