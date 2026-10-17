# @rr/db

SQL migrations (`migrations/*.sql`, plain SQL, never edited after release), the PostgreSQL and PGlite adapters behind one `Db` interface, a migration runner, and a test harness (`@rr/db/testing`) that runs every suite on both engines.

After adding a migration: `pnpm --filter @rr/db embed` (CI fails if the generated file is stale).
