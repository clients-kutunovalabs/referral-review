import type { Ctx } from "./ctx";

const KEY = "worker_heartbeat";
/** The worker loop writes this every minute. Older than this and a monitor should treat the worker as down. */
export const WORKER_STALE_SECONDS = 10 * 60;

export async function recordHeartbeat(ctx: Ctx): Promise<void> {
  await ctx.db.query(
    "insert into settings (workspace_id, key, value) values ($1,$2,$3) on conflict (workspace_id, key) do update set value = excluded.value",
    [ctx.cfg.workspaceId, KEY, ctx.now().toISOString()]);
}

export interface WorkerHealth { state: "ok" | "stale" | "never"; ageSeconds?: number }

/** Whether the background worker (which expires timed-out claims) has checked in recently. */
export async function workerHealth(ctx: Ctx): Promise<WorkerHealth> {
  const [r] = await ctx.db.query<{ value: string }>("select value from settings where workspace_id = $1 and key = $2", [ctx.cfg.workspaceId, KEY]);
  if (!r) return { state: "never" };
  const ageSeconds = Math.max(Math.round((ctx.now().getTime() - new Date(r.value).getTime()) / 1000), 0);
  return { state: ageSeconds > WORKER_STALE_SECONDS ? "stale" : "ok", ageSeconds };
}
