import { expireClaims, purgeExpired, purgeUnusedFiles, recordHeartbeat, reconcile, sendAlert, type Ctx } from "@rr/server";

export type Log = (event: string, data?: Record<string, unknown>) => void;

/** `filesEveryMs` defaults to 30 days: uploads nobody used are cleaned up monthly. */
export interface Schedule { expireEveryMs: number; purgeEveryMs: number; reconcileEveryMs: number; filesEveryMs?: number }
const MONTH_MS = 30 * 86_400_000;
export const DEFAULT_SCHEDULE: Schedule = { expireEveryMs: 60_000, purgeEveryMs: 3_600_000, reconcileEveryMs: 6 * 3_600_000, filesEveryMs: MONTH_MS };

/** Claims past their deadline become expired, which frees the slot. */
export async function runExpire(ctx: Ctx, log: Log): Promise<number> {
  const n = await expireClaims(ctx);
  if (n) log("claims.expired", { count: n });
  return n;
}

export async function runPurge(ctx: Ctx, log: Log) {
  const r = await purgeExpired(ctx);
  log("housekeeping", r);
  return r;
}

/** Monthly: uploads older than 30 days that no submission, payment or ticket uses. */
export async function runPurgeFiles(ctx: Ctx, log: Log): Promise<number> {
  const n = await purgeUnusedFiles(ctx);
  log("files.purged", { count: n });
  return n;
}

/** A non-empty problem list is logged as an error: it means money records disagree and nobody should be paid until it is understood. */
export async function runReconcile(ctx: Ctx, log: Log) {
  const r = await reconcile(ctx);
  log(r.ok ? "reconcile.ok" : "reconcile.PROBLEMS", r.ok ? {} : { problems: r.problems });
  if (!r.ok) await sendAlert(ctx, `Money records disagree (${r.problems.length} problem${r.problems.length === 1 ? "" : "s"}). Stop marking payouts as paid until it is understood: see the runbook.`, "reconcile");
  return r;
}

/**
 * Runs the jobs on their schedules until `signal` aborts. A failing job is logged and tried again next time; it never stops the loop.
 * `now` and `sleep` are injectable so the schedule can be tested without waiting.
 */
export async function work(ctx: Ctx, log: Log, signal: AbortSignal, schedule: Schedule = DEFAULT_SCHEDULE, clock: { now: () => number; sleep: (ms: number) => Promise<void> } = { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }): Promise<void> {
  const next = { heartbeat: 0, expire: 0, purge: 0, reconcile: 0, files: 0 };
  const due = async (key: keyof typeof next, every: number, job: () => Promise<unknown>, name: string) => {
    if (clock.now() < next[key]) return;
    next[key] = clock.now() + every;
    try { await job(); } catch (err) {
      log("job.failed", { job: name, error: err instanceof Error ? err.message : String(err) });
      await sendAlert(ctx, `Background job "${name}" failed. Check the worker logs.`, `job:${name}`);
    }
  };
  log("worker.start");
  while (!signal.aborted) {
    await due("heartbeat", 60_000, () => recordHeartbeat(ctx), "heartbeat");
    await due("expire", schedule.expireEveryMs, () => runExpire(ctx, log), "expire");
    await due("purge", schedule.purgeEveryMs, () => runPurge(ctx, log), "purge");
    await due("reconcile", schedule.reconcileEveryMs, () => runReconcile(ctx, log), "reconcile");
    await due("files", schedule.filesEveryMs ?? MONTH_MS, () => runPurgeFiles(ctx, log), "files");
    await clock.sleep(Math.min(5_000, schedule.expireEveryMs));
  }
  log("worker.stop");
}
