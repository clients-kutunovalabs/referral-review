import type { Ctx } from "./ctx";
import { hmac, randomToken, sha256 } from "./crypto";
import type { Queryable } from "@rr/db";

const TOUCH_AFTER_MS = 5 * 60_000;
const MAX_SESSIONS_PER_USER = 20;

/** `refreshed` is true when this visit pushed the end of the session out again, so the cookie must be re-issued with the new lifetime. */
export interface SessionInfo { sessionId: string; userId: string; expiresAt: Date; refreshed: boolean }

const idleMs = (ctx: Ctx): number => ctx.cfg.sessionIdleHours * 3_600_000;

export async function createSession(ctx: Ctx, userId: string, meta: { ip?: string | undefined; userAgent?: string | undefined } = {}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const now = ctx.now();
  const expiresAt = new Date(now.getTime() + idleMs(ctx));
  await ctx.db.tx(async (t) => {
    await t.query("insert into sessions (token_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent) values ($1,$2,$3,$4,$3,$5,$6)",
      [sha256(token), userId, now, expiresAt, meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null]);
    await t.query(
      "delete from sessions where user_id = $1 and id not in (select id from sessions where user_id = $1 order by created_at desc limit $2)", [userId, MAX_SESSIONS_PER_USER]);
  });
  return { token, expiresAt };
}

/** The live session for a cookie token, or null. Suspended and deleted users have no live session. A session left idle past its limit is gone. */
export async function resolveSession(ctx: Ctx, token: string): Promise<SessionInfo | null> {
  const now = ctx.now();
  const [s] = await ctx.db.query<{ id: string; user_id: string; expires_at: Date; last_seen_at: Date; status: string }>(
    "select s.id, s.user_id, s.expires_at, s.last_seen_at, u.status from sessions s join users u on u.id = s.user_id where s.token_hash = $1", [sha256(token)]);
  if (!s || s.expires_at <= now || s.status !== "active") return null;
  // Sliding window: a visit restarts the idle count from zero. Written at most every few minutes, not on every request.
  if (now.getTime() - s.last_seen_at.getTime() > TOUCH_AFTER_MS) {
    const expiresAt = new Date(now.getTime() + idleMs(ctx));
    await ctx.db.query("update sessions set last_seen_at = $2, expires_at = $3 where id = $1", [s.id, now, expiresAt]);
    return { sessionId: s.id, userId: s.user_id, expiresAt, refreshed: true };
  }
  return { sessionId: s.id, userId: s.user_id, expiresAt: s.expires_at, refreshed: false };
}

export async function revokeSession(ctx: Ctx, token: string): Promise<void> {
  await ctx.db.query("delete from sessions where token_hash = $1", [sha256(token)]);
}

export async function revokeUserSessions(q: Queryable, userId: string): Promise<void> {
  await q.query("delete from sessions where user_id = $1", [userId]);
}

/** Bound to the session, so a token stolen from one session is useless in another. */
export const csrfToken = (ctx: Ctx, sessionId: string): string => hmac(ctx.cfg.secret, `csrf:${sessionId}`);
