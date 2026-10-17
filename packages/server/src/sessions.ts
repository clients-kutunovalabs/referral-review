import type { Ctx } from "./ctx";
import { hmac, randomToken, sha256 } from "./crypto";
import type { Queryable } from "@rr/db";

const TOUCH_AFTER_MS = 5 * 60_000;
const MAX_SESSIONS_PER_USER = 20;

export interface SessionInfo { sessionId: string; userId: string; expiresAt: Date }

export async function createSession(ctx: Ctx, userId: string, meta: { ip?: string | undefined; userAgent?: string | undefined } = {}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const now = ctx.now();
  const expiresAt = new Date(now.getTime() + ctx.cfg.sessionDays * 86_400_000);
  await ctx.db.tx(async (t) => {
    await t.query("insert into sessions (token_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent) values ($1,$2,$3,$4,$3,$5,$6)",
      [sha256(token), userId, now, expiresAt, meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null]);
    await t.query(
      "delete from sessions where user_id = $1 and id not in (select id from sessions where user_id = $1 order by created_at desc limit $2)", [userId, MAX_SESSIONS_PER_USER]);
  });
  return { token, expiresAt };
}

/** The live session for a cookie token, or null. Suspended and deleted users have no live session. */
export async function resolveSession(ctx: Ctx, token: string): Promise<SessionInfo | null> {
  const now = ctx.now();
  const [s] = await ctx.db.query<{ id: string; user_id: string; expires_at: Date; last_seen_at: Date; status: string }>(
    "select s.id, s.user_id, s.expires_at, s.last_seen_at, u.status from sessions s join users u on u.id = s.user_id where s.token_hash = $1", [sha256(token)]);
  if (!s || s.expires_at <= now || s.status !== "active") return null;
  if (now.getTime() - s.last_seen_at.getTime() > TOUCH_AFTER_MS) await ctx.db.query("update sessions set last_seen_at = $2 where id = $1", [s.id, now]);
  return { sessionId: s.id, userId: s.user_id, expiresAt: s.expires_at };
}

export async function revokeSession(ctx: Ctx, token: string): Promise<void> {
  await ctx.db.query("delete from sessions where token_hash = $1", [sha256(token)]);
}

export async function revokeUserSessions(q: Queryable, userId: string): Promise<void> {
  await q.query("delete from sessions where user_id = $1", [userId]);
}

/** Bound to the session, so a token stolen from one session is useless in another. */
export const csrfToken = (ctx: Ctx, sessionId: string): string => hmac(ctx.cfg.secret, `csrf:${sessionId}`);
