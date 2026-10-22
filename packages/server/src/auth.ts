import { errorText, logEvent } from "./log";
import { OTP_RULES, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type CodePurpose, type CodeSent } from "@rr/core";
import { isUniqueViolation } from "@rr/db";
import { checkCode, issueCode } from "./codes";
import type { Ctx } from "./ctx";
import { dummyHash, hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { ApiError, fail } from "./errors";
import { clear, clearFamily, hit } from "./ratelimit";
import { revokeOtherSessions, revokeUserSessions } from "./sessions";

export const normaliseEmail = (e: string): string => e.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (e: string): boolean => e.length <= 254 && EMAIL.test(e);

/**
 * Identity provider. The built-in one below keeps passwords and codes in our database so the site is launchable on its own.
 * An external provider (Authgate) implements the same interface: it proves who someone is, and the site keeps its own
 * user rows and sessions either way.
 */
export interface AuthProvider {
  requestCode(email: string, purpose: CodePurpose, profile?: Record<string, string>): Promise<CodeSent>;
  verifyCode(email: string, code: string, purpose: CodePurpose): Promise<{ ticket: string }>;
  /** Creates the account (user, main email, credentials) once the email is proven. */
  completeSignup(ticket: string, password: string): Promise<{ userId: string }>;
  completeReset(ticket: string, password: string): Promise<{ userId: string }>;
  /** `ip` is the caller's address, so failed guesses lock that email for that address, not for everyone. */
  signIn(email: string, password: string, ip?: string): Promise<{ userId: string }>;
  /** A logged-in person sets a new password by proving the current one. Every other browser is signed out; this one stays. */
  changePassword(userId: string, sessionId: string, current: string, next: string): Promise<void>;
}

function checkPassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) fail("weak_password", `Password needs at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (password.length > PASSWORD_MAX_LENGTH) fail("weak_password", `Password can be at most ${PASSWORD_MAX_LENGTH} characters.`);
}

/**
 * Wrong passwords are counted per email AND address (5 per 15 minutes), so a stranger guessing from elsewhere cannot keep a
 * worker locked out. A higher ceiling per email from all addresses together (30 per hour) still stops a spread-out attack.
 */
const SIGN_IN_FAILURES = { limit: 5, windowSeconds: 15 * 60 };
const SIGN_IN_CEILING = { limit: 30, windowSeconds: 3600 };
/** Site-wide backstop on sign-up codes, in case per-address limits are fooled (a wrong TRUST_PROXY_HOPS). */
export const SIGNUP_CODES_PER_HOUR = 300;
/** Answered for every sign-up request, so the reply never tells whether an account already uses the email. */

const TICKET_TTL_MS = OTP_RULES.ttlMs;

function cleanProfile(p: Record<string, string> | undefined): Record<string, string> {
  const name = (p?.["name"] ?? "").trim();
  const phone = (p?.["phone"] ?? "").replace(/[\s-]/g, "");
  if (!name) fail("bad_request", "Enter your full name.");
  if (name.length > 100) fail("bad_request", "That name is too long.");
  if (phone && !/^\+?\d{7,15}$/.test(phone)) fail("bad_request", "Enter a valid phone number.");
  return { name, ...(phone ? { phone } : {}) };
}

export function createBuiltinAuth(ctx: Ctx): AuthProvider {
  const sendCode = async (to: string, kind: "signup_code" | "reset_code", code: string) => {
    await ctx.email.send({ to, kind, code, expiresInMinutes: OTP_RULES.ttlMs / 60_000 });
  };

  return {
    async requestCode(rawEmail, purpose, profile) {
      const email = normaliseEmail(rawEmail);
      if (!isEmail(email)) fail("invalid_email", "Enter a valid email address.");
      const [ident] = await ctx.db.query<{ user_id: string; is_primary: boolean }>("select user_id, is_primary from identities where workspace_id = $1 and lower(email) = $2 and released_at is null", [ctx.cfg.workspaceId, email]);
      if (purpose === "signup") {
        const clean = cleanProfile(profile);
        // An email that is already in use gets the same answer and the same limits, but no code: the screen tells the person
        // to log in or reset their password if no code arrives. Only one-time codes are ever emailed, so nothing else is sent.
        if (ident) return (await issueCode(ctx, `signup:${email}`, { deliver: false })).sent;
        const all = await hit(ctx.db, "otp:signup:all", SIGNUP_CODES_PER_HOUR, 3600, ctx.now());
        if (!all.allowed) throw new ApiError("rate_limited", "Sign-up is busy right now. Please try again in a little while.", 429, all.retryAfterSeconds);
        const { sent, code } = await issueCode(ctx, `signup:${email}`, { deliver: true, profile: clean });
        try { await sendCode(email, "signup_code", code as string); }
        catch (err) { logEvent("error", "email.signup_code_failed", { error: errorText(err) }); fail("internal", "We could not send the email. Please try again.", 502); }
        return sent;
      }
      // Reset: only a main (login) email of an active account gets a code, but the answer is identical either way.
      let deliver = false;
      if (ident?.is_primary) {
        const [u] = await ctx.db.query<{ status: string }>("select status from users where id = $1", [ident.user_id]);
        deliver = u?.status === "active";
      }
      const { sent, code } = await issueCode(ctx, `reset:${email}`, { deliver });
      if (code) {
        try { await sendCode(email, "reset_code", code); }
        catch (err) { logEvent("error", "email.reset_code_failed", { error: errorText(err) }); }
      }
      return sent;
    },

    async verifyCode(rawEmail, code, purpose) {
      const email = normaliseEmail(rawEmail);
      const { profile } = await checkCode(ctx, `${purpose}:${email}`, code);
      const token = randomToken(32);
      await ctx.db.query("insert into auth_tickets (token_hash, email, purpose, profile, expires_at) values ($1,$2,$3,$4,$5)",
        [sha256(token), email, purpose, JSON.stringify(profile), new Date(ctx.now().getTime() + TICKET_TTL_MS)]);
      return { ticket: token };
    },

    async completeSignup(ticket, password) {
      checkPassword(password);
      const passwordHash = await hashPassword(password);
      try {
        return await ctx.db.tx(async (t) => {
          const [tk] = await t.query<{ email: string; profile: Record<string, string> }>(
            "delete from auth_tickets where token_hash = $1 and purpose = 'signup' and expires_at > $2 returning email, profile", [sha256(ticket), ctx.now()]);
          if (!tk) return fail("invalid_code", "This step has expired. Start again.");
          const [u] = await t.query<{ id: string }>("insert into users (workspace_id, name, phone, created_at) values ($1,$2,$3,$4) returning id",
            [ctx.cfg.workspaceId, tk.profile["name"] ?? "Member", tk.profile["phone"] ?? null, ctx.now()]);
          await t.query("insert into identities (workspace_id, user_id, email, is_primary, verified_at, created_at) values ($1,$2,$3,true,$4,$4)", [ctx.cfg.workspaceId, u!.id, tk.email, ctx.now()]);
          await t.query("insert into auth_credentials (user_id, password_hash, updated_at) values ($1,$2,$3)", [u!.id, passwordHash, ctx.now()]);
          return { userId: u!.id };
        });
      } catch (err) {
        if (isUniqueViolation(err)) return fail("email_taken", "An account with this email already exists. Log in instead.");
        throw err;
      }
    },

    async completeReset(ticket, password) {
      checkPassword(password);
      const passwordHash = await hashPassword(password);
      return ctx.db.tx(async (t) => {
        const [tk] = await t.query<{ email: string }>("delete from auth_tickets where token_hash = $1 and purpose = 'reset' and expires_at > $2 returning email", [sha256(ticket), ctx.now()]);
        if (!tk) return fail("invalid_code", "This step has expired. Start again.");
        const [i] = await t.query<{ user_id: string }>("select user_id from identities where workspace_id = $1 and lower(email) = $2 and is_primary and released_at is null", [ctx.cfg.workspaceId, tk.email]);
        if (!i) return fail("invalid_code", "This step has expired. Start again.");
        const [u] = await t.query<{ status: string }>("select status from users where id = $1", [i.user_id]);
        if (u?.status !== "active") return fail("suspended", "This account is suspended. Contact support.", 403);
        await t.query(
          "insert into auth_credentials (user_id, password_hash, updated_at) values ($1,$2,$3) on conflict (user_id) do update set password_hash = excluded.password_hash, updated_at = excluded.updated_at",
          [i.user_id, passwordHash, ctx.now()]);
        await revokeUserSessions(t, i.user_id); // a reset signs out everywhere else
        await clearFamily(t, `signin:${tk.email}`);
        return { userId: i.user_id };
      });
    },

    async changePassword(userId, sessionId, current, next) {
      checkPassword(next);
      if (next === current) fail("weak_password", "Choose a password that is different from the current one.");
      // Counted before the check, like sign-in, so a stolen session cannot be used to guess the password in parallel.
      const key = `chpw:${userId}`;
      const h = await hit(ctx.db, key, 5, 15 * 60, ctx.now());
      if (!h.allowed) throw new ApiError("rate_limited", "Too many wrong attempts. Try again later.", 429, h.retryAfterSeconds);
      const [row] = await ctx.db.query<{ password_hash: string }>("select password_hash from auth_credentials where user_id = $1", [userId]);
      const ok = await verifyPassword(current, row?.password_hash ?? (await dummyHash()));
      // 400, not 401: the person is logged in, and a 401 would make the app think the session ended.
      if (!row || !ok) return fail("invalid_credentials", "Your current password is not right.", 400);
      const hash = await hashPassword(next);
      await ctx.db.tx(async (t) => {
        await t.query("update auth_credentials set password_hash = $2, updated_at = $3 where user_id = $1", [userId, hash, ctx.now()]);
        await revokeOtherSessions(t, userId, sessionId);
        await clear(t, key);
      });
    },

    async signIn(rawEmail, password, ip = "unknown") {
      const email = normaliseEmail(rawEmail);
      const key = `signin:${email}`;
      const now = ctx.now();
      // Attempts are counted BEFORE the password is checked. Counting afterwards let many parallel guesses all pass the check
      // while the counter was still low. A correct password clears the counts, so honest users never accumulate them.
      const here = await hit(ctx.db, `${key}:${ip}`, SIGN_IN_FAILURES.limit, SIGN_IN_FAILURES.windowSeconds, now);
      const everywhere = await hit(ctx.db, key, SIGN_IN_CEILING.limit, SIGN_IN_CEILING.windowSeconds, now);
      if (!here.allowed || !everywhere.allowed) {
        throw new ApiError("rate_limited", "Too many failed attempts. Try again later.", 429, Math.max(here.allowed ? 0 : here.retryAfterSeconds, everywhere.allowed ? 0 : everywhere.retryAfterSeconds));
      }
      const [row] = await ctx.db.query<{ user_id: string; password_hash: string; status: string }>(
        `select i.user_id, c.password_hash, u.status from identities i join users u on u.id = i.user_id join auth_credentials c on c.user_id = i.user_id
         where i.workspace_id = $1 and lower(i.email) = $2 and i.is_primary and i.released_at is null`, [ctx.cfg.workspaceId, email]);
      // Same work whether or not the account exists, so response time does not reveal it.
      const ok = await verifyPassword(password, row?.password_hash ?? (await dummyHash()));
      if (!row || !ok) return fail("invalid_credentials", "Email or password is incorrect.", 401);
      if (row.status !== "active") return fail("suspended", "This account is suspended. Contact support.", 403);
      await clearFamily(ctx.db, key);
      return { userId: row.user_id };
    }
  };
}
