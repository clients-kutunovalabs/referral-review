import type { Ctx } from "./ctx";

/** Removes rows that are only useful while fresh. Never touches money, reviews, tickets or the audit log. */
export async function purgeExpired(ctx: Ctx): Promise<{ sessions: number; codes: number; tickets: number; rateLimits: number }> {
  const now = ctx.now();
  const count = async (sql: string, p: unknown[]) => (await ctx.db.query(sql, p)).length;
  return {
    sessions: await count("delete from sessions where expires_at <= $1 returning id", [now]),
    codes: await count("delete from auth_codes where expires_at <= $1 returning key", [new Date(now.getTime() - 86_400_000)]),
    tickets: await count("delete from auth_tickets where expires_at <= $1 returning token_hash", [now]),
    rateLimits: await count("delete from rate_limits where window_start <= $1 returning key", [new Date(now.getTime() - 2 * 86_400_000)])
  };
}
