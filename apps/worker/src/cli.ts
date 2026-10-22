import { migrate } from "@rr/db";
import { createRuntime, seedOwner } from "@rr/server/runtime-api";
import { DEFAULT_SCHEDULE, runExpire, runPurge, runPurgeFiles, runPurgeScreenshots, runReconcile, work, type Log } from "./jobs";

const log: Log = (event, data = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));

const USAGE = `Usage: pnpm --filter @rr/worker cli <command>
  migrate     apply database migrations
  seed        make sure the owner (OWNER_EMAIL / OWNER_PASSWORD) exists
  work        run the background jobs until stopped (expire claims, housekeeping, reconcile)
  expire      expire overdue claims once
  purge       remove stale sessions, codes and rate-limit rows, and release emails of accounts deleted 30+ days ago, once
  purge-files delete uploads older than 30 days that nothing uses, once (the worker also does this monthly)
  purge-screenshots  delete screenshots of work reviewed / tickets resolved 30+ days ago, once (the worker also does this daily)
  reconcile   recompute the money and report any mismatch (exit code 2 if there is one)`;

async function main(): Promise<number> {
  const command = process.argv[2];
  if (!command || !["migrate", "seed", "work", "expire", "purge", "purge-files", "purge-screenshots", "reconcile"].includes(command)) { console.log(USAGE); return command ? 1 : 0; }
  const rt = await createRuntime();
  try {
    if (command === "migrate") { log("migrate", { applied: await migrate(rt.db) }); return 0; }
    if (command === "seed") {
      if (!rt.cfg.owner) { log("seed.skipped", { reason: "OWNER_EMAIL and OWNER_PASSWORD are not set" }); return 1; }
      log("seed", { owner: await seedOwner(rt.ctx, rt.cfg.owner) });
      return 0;
    }
    if (command === "expire") { await runExpire(rt.ctx, log); return 0; }
    if (command === "purge") { await runPurge(rt.ctx, log); return 0; }
    if (command === "purge-files") { await runPurgeFiles(rt.ctx, log); return 0; }
    if (command === "purge-screenshots") { await runPurgeScreenshots(rt.ctx, log); return 0; }
    if (command === "reconcile") return (await runReconcile(rt.ctx, log)).ok ? 0 : 2;
    const stop = new AbortController();
    for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => stop.abort());
    if (rt.cfg.autoMigrate) log("migrate", { applied: await migrate(rt.db) });
    await work(rt.ctx, log, stop.signal, DEFAULT_SCHEDULE);
    return 0;
  } finally {
    await rt.close();
  }
}

main().then((code) => process.exit(code), (err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
