import type { Db } from "./db";
import { MIGRATIONS } from "./migrations.generated";

const LOCK_KEY = 727274;

/** Applies every migration not yet recorded, in order, inside one transaction guarded by an advisory lock (safe if two instances start together). */
export async function migrate(db: Db): Promise<string[]> {
  return db.tx(async (t) => {
    await t.query("select pg_advisory_xact_lock($1)", [LOCK_KEY]);
    await t.exec("create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())");
    const done = new Set((await t.query<{ id: string }>("select id from schema_migrations")).map((r) => r.id));
    const applied: string[] = [];
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await t.exec(m.sql);
      await t.query("insert into schema_migrations (id) values ($1)", [m.id]);
      applied.push(m.id);
    }
    return applied;
  });
}
