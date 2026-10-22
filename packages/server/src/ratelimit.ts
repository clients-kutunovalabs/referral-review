import type { Queryable } from "@rr/db";

export interface Hit { allowed: boolean; count: number; retryAfterSeconds: number }

/**
 * Fixed-window counter kept in the database, so the limit holds across several app instances.
 * `hit` counts this request and says whether it is still within the limit.
 */
function windowOf(now: Date, windowSeconds: number): { start: Date; endsInSeconds: number } {
  const ms = windowSeconds * 1000;
  const startMs = Math.floor(now.getTime() / ms) * ms;
  return { start: new Date(startMs), endsInSeconds: Math.max(Math.ceil((startMs + ms - now.getTime()) / 1000), 1) };
}

export async function hit(q: Queryable, key: string, limit: number, windowSeconds: number, now: Date): Promise<Hit> {
  const w = windowOf(now, windowSeconds);
  const [r] = await q.query<{ count: number }>(
    "insert into rate_limits (key, window_start, count) values ($1, $2, 1) on conflict (key, window_start) do update set count = rate_limits.count + 1 returning count", [key, w.start]);
  const count = r!.count;
  return { allowed: count <= limit, count, retryAfterSeconds: w.endsInSeconds };
}

export async function clear(q: Queryable, key: string): Promise<void> {
  await q.query("delete from rate_limits where key = $1", [key]);
}

/** Clears `key` and every key that starts with `key:` (for example one email's per-address counters). */
export async function clearFamily(q: Queryable, key: string): Promise<void> {
  await q.query("delete from rate_limits where key = $1 or left(key, length($2)) = $2", [key, `${key}:`]);
}
