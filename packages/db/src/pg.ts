import pg from "pg";
import { INT8_OID, bindParams, parseInt8, type Db, type Queryable, type Row } from "./db";

export interface PgOptions {
  connectionString: string;
  max?: number;
  /** Put every table in this schema (tests use one schema per run). */
  schema?: string;
  ssl?: boolean;
}

const types = {
  getTypeParser: ((oid: number, format?: string) =>
    oid === INT8_OID ? parseInt8 : pg.types.getTypeParser(oid, (format as "text" | "binary" | undefined) ?? "text")) as typeof pg.types.getTypeParser
};

function wrap(client: pg.Pool | pg.PoolClient): Queryable {
  return {
    async query<T = Row>(sql: string, params?: readonly unknown[]) {
      const res = await client.query(sql, bindParams(params));
      return res.rows as T[];
    },
    async exec(sql: string) { await client.query(sql); }
  };
}

export function createPgDb(opts: PgOptions): Db {
  const pool = new pg.Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 10,
    types,
    ...(opts.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
    ...(opts.schema ? { options: `-c search_path=${opts.schema}` } : {})
  });
  const base = wrap(pool);
  return {
    ...base,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const out = await fn(wrap(client));
        await client.query("commit");
        return out;
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end()
  };
}
