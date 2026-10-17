/**
 * The only database surface the rest of the code sees. Two adapters implement it: real PostgreSQL (`pg`, used in production
 * against Vista) and PGlite (Postgres compiled to WebAssembly: zero install, used for local dev and fast tests).
 * Both speak the same SQL, so migrations, triggers and row locks behave the same.
 */
export type Row = Record<string, unknown>;

export interface Queryable {
  /** Runs one statement with $1, $2 ... parameters and returns its rows. bigint columns come back as bigint. */
  query<T = Row>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  /** Runs one or more statements with no parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Runs `fn` in one transaction (read committed). Throw to roll back. Transactions do not nest. */
  tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** bigint parameters travel as decimal strings: drivers disagree on bigint, none disagree on text. */
export const bindParams = (params: readonly unknown[] | undefined): unknown[] =>
  (params ?? []).map((p) => (typeof p === "bigint" ? p.toString() : p));

export const INT8_OID = 20;
export const parseInt8 = (v: string): bigint => BigInt(v);

/** Postgres error code of a thrown driver error, e.g. "23505" for a unique violation. */
export function pgCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}
export const isUniqueViolation = (err: unknown): boolean => pgCode(err) === "23505";
/** Name of the index or constraint a failed statement hit (both drivers report it), so a caller can tell which rule was broken. */
export const violatedConstraint = (err: unknown): string | undefined => {
  const c = (err as { constraint?: unknown } | null)?.constraint;
  return typeof c === "string" ? c : undefined;
};
