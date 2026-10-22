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

/**
 * Server-side limits on every connection: a query that runs for more than a minute, or a transaction left open and idle for a
 * minute (a crashed request), is stopped by the database instead of holding locks on money rows.
 */
const SESSION_OPTIONS = "-c statement_timeout=60000 -c idle_in_transaction_session_timeout=60000";

export function createPgDb(opts: PgOptions & { onError?: (err: Error) => void }): Db {
  const pool = new pg.Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 10,
    connectionTimeoutMillis: 10_000, // a database that does not answer fails the request instead of hanging it
    types,
    ...(opts.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
    options: `${SESSION_OPTIONS}${opts.schema ? ` -c search_path=${opts.schema}` : ""}`
  });
  // An idle connection that drops (database restart, network blip) is reported here. Without a listener node-postgres
  // would throw it as an unhandled error and stop the whole web server or worker. The pool replaces the connection itself.
  pool.on("error", opts.onError ?? ((err) => console.error(JSON.stringify({ at: new Date().toISOString(), level: "error", event: "db.idle_connection_error", error: err.message }))));
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
