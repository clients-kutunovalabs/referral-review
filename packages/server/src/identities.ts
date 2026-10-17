import type { Identity, Me } from "@rr/core";
import { isUniqueViolation } from "@rr/db";
import { OTP_RULES, type CodeSent } from "@rr/core";
import { isEmail, normaliseEmail } from "./auth";
import { checkCode, issueCode } from "./codes";
import type { Ctx } from "./ctx";
import { conflict, fail, notFound } from "./errors";

async function identitiesOf(ctx: Ctx, userId: string): Promise<Identity[]> {
  const rows = await ctx.db.query<{ id: string; email: string; is_primary: boolean; earned: bigint }>(
    `select i.id, i.email, i.is_primary,
            coalesce((select sum(w.amount_paise) from wallet_transactions w where w.identity_id = i.id and w.kind = 'credit'), 0)::bigint as earned
     from identities i where i.user_id = $1 order by i.is_primary desc, i.created_at`, [userId]);
  return rows.map((r) => ({ id: r.id, email: r.email, isPrimary: r.is_primary, earned: r.earned }));
}

export async function getMe(ctx: Ctx, userId: string): Promise<Me> {
  const [u] = await ctx.db.query<{ name: string; phone: string | null; is_admin: boolean }>(
    "select u.name, u.phone, exists (select 1 from admin_members m where m.user_id = u.id) as is_admin from users u where u.id = $1", [userId]);
  if (!u) return notFound("Account");
  const identities = await identitiesOf(ctx, userId);
  return { userId, name: u.name, phone: u.phone, email: identities.find((i) => i.isPrimary)?.email ?? "", identities, isAdmin: u.is_admin };
}

const key = (userId: string, email: string) => `identity:${userId}:${email}`;

/** Step one of adding another email: send it a code. */
export async function sendIdentityCode(ctx: Ctx, userId: string, rawEmail: string): Promise<CodeSent> {
  const email = normaliseEmail(rawEmail);
  if (!isEmail(email)) fail("invalid_email", "Enter a valid email address.");
  const [taken] = await ctx.db.query("select 1 from identities where workspace_id = $1 and lower(email) = $2", [ctx.cfg.workspaceId, email]);
  if (taken) return conflict("email_taken", "That email is already linked to an account.");
  const [{ n } = { n: 0 }] = await ctx.db.query<{ n: number }>("select count(*)::int as n from identities where user_id = $1", [userId]);
  if (n >= ctx.cfg.maxIdentitiesPerUser) fail("bad_request", `You can link up to ${ctx.cfg.maxIdentitiesPerUser} emails.`);
  const { sent, code } = await issueCode(ctx, key(userId, email), { deliver: true });
  try { await ctx.email.send({ to: email, kind: "identity_code", code: code as string, expiresInMinutes: OTP_RULES.ttlMs / 60_000 }); }
  catch (err) { console.error("[email] could not send identity code:", err instanceof Error ? err.message : err); fail("internal", "We could not send the email. Please try again.", 502); }
  return sent;
}

/** Step two: the right code links the email to this account, as a sub-account that shares the wallet. */
export async function addIdentity(ctx: Ctx, userId: string, rawEmail: string, code: string): Promise<Identity> {
  const email = normaliseEmail(rawEmail);
  await checkCode(ctx, key(userId, email), code);
  try {
    const [r] = await ctx.db.query<{ id: string }>(
      "insert into identities (workspace_id, user_id, email, is_primary, verified_at, created_at) values ($1,$2,$3,false,$4,$4) returning id", [ctx.cfg.workspaceId, userId, email, ctx.now()]);
    return { id: r!.id, email, isPrimary: false, earned: 0n };
  } catch (err) {
    if (isUniqueViolation(err)) return conflict("email_taken", "That email is already linked to an account.");
    throw err;
  }
}
