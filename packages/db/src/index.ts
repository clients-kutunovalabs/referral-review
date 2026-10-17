export * from "./db";
export { createPgDb, type PgOptions } from "./pg";
export { createPgliteDb } from "./pglite";
export { migrate } from "./migrate";
export { MIGRATIONS } from "./migrations.generated";

/** The single seeded workspace and owner role (see migrations/0001_init.sql). */
export const DEFAULT_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
export const OWNER_ROLE_ID = "00000000-0000-0000-0000-0000000000a1";
