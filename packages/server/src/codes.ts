import { OTP_RULES, CODE_LENGTH, type CodeSent } from "@rr/core";
import type { Queryable } from "@rr/db";
import type { Ctx } from "./ctx";
import { ApiError } from "./errors";
import { randomInt } from "node:crypto";
import { safeEqual, sha256 } from "./crypto";
import { hit } from "./ratelimit";

const hashOf = (ctx: Ctx, key: string, code: string) => sha256(`${ctx.cfg.secret}|${key}|${code}`);
const newCode = (): string => Array.from({ length: CODE_LENGTH }, () => String(randomInt(10))).join("");

/**
 * Creates a one-time code for `key`. Applies the 30 second resend cooldown and the 5 per hour limit.
 * With `deliver: false` (an unknown email on password reset) it applies the same limits and timing but creates nothing,
 * so the response never reveals whether an account exists.
 */
export async function issueCode(ctx: Ctx, key: string, opts: { deliver: boolean; profile?: Record<string, string> }): Promise<{ sent: CodeSent; code: string | null }> {
  const now = ctx.now();
  const sent: CodeSent = { expiresInSeconds: OTP_RULES.ttlMs / 1000, resendAfterSeconds: OTP_RULES.resendMs / 1000 };
  return ctx.db.tx(async (t) => {
    const [prev] = await t.query<{ sent_at: Date }>("select sent_at from auth_codes where key = $1 for update", [key]);
    if (prev) {
      const wait = OTP_RULES.resendMs - (now.getTime() - prev.sent_at.getTime());
      if (wait > 0) throw new ApiError("rate_limited", "Wait a moment before asking for another code.", 429, Math.ceil(wait / 1000));
    }
    const h = await hit(t, `otp:${key}`, OTP_RULES.maxRequestsPerHour, 3600, now);
    if (!h.allowed) throw new ApiError("rate_limited", "Too many codes requested. Try again later.", 429, h.retryAfterSeconds);
    if (!opts.deliver) { await t.query("delete from auth_codes where key = $1", [key]); return { sent, code: null }; }
    const code = newCode();
    await t.query(
      `insert into auth_codes (key, code_hash, expires_at, attempts, sent_at, profile) values ($1,$2,$3,0,$4,$5)
       on conflict (key) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at, profile = excluded.profile`,
      [key, hashOf(ctx, key, code), new Date(now.getTime() + OTP_RULES.ttlMs), now, JSON.stringify(opts.profile ?? {})]);
    return { sent, code };
  });
}

/**
 * Checks a code. Wrong guesses are counted and saved even though the caller then gets an error, so an attacker cannot
 * retry for free: the check runs in its own committed transaction and the error is thrown after it.
 */
export async function checkCode(ctx: Ctx, key: string, code: string): Promise<{ profile: Record<string, string> }> {
  const now = ctx.now();
  const outcome = await ctx.db.tx(async (t: Queryable): Promise<{ error: ApiError } | { profile: Record<string, string> }> => {
    const [row] = await t.query<{ code_hash: string; expires_at: Date; attempts: number; profile: Record<string, string> }>("select code_hash, expires_at, attempts, profile from auth_codes where key = $1 for update", [key]);
    if (!row) return { error: new ApiError("invalid_code", "That code is not valid. Request a new one.", 400) };
    if (row.attempts >= OTP_RULES.maxWrongAttempts) return { error: new ApiError("too_many_attempts", "Too many wrong codes. Request a new code.", 400) };
    if (now >= row.expires_at) {
      await t.query("delete from auth_codes where key = $1", [key]);
      return { error: new ApiError("code_expired", "That code has expired. Request a new one.", 400) };
    }
    if (!safeEqual(row.code_hash, hashOf(ctx, key, code))) {
      const attempts = row.attempts + 1;
      await t.query("update auth_codes set attempts = $2 where key = $1", [key, attempts]);
      const left = OTP_RULES.maxWrongAttempts - attempts;
      return { error: left <= 0 ? new ApiError("too_many_attempts", "Too many wrong codes. Request a new code.", 400) : new ApiError("invalid_code", `That code is wrong. ${left} attempt${left === 1 ? "" : "s"} left.`, 400) };
    }
    await t.query("delete from auth_codes where key = $1", [key]);
    return { profile: row.profile };
  });
  if ("error" in outcome) throw outcome.error;
  return outcome;
}
