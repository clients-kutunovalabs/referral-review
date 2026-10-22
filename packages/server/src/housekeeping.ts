import { audit } from "./audit";
import type { Ctx } from "./ctx";
import { logEvent } from "./log";

const DAY_MS = 86_400_000;
/** Emails of a deleted account become free to sign up again this long after the deletion. Records stay. */
export const EMAIL_RELEASE_DAYS = 30;
/** Uploads that nothing refers to are removed once they are this old. */
export const UNUSED_FILE_DAYS = 30;

/** Removes rows that are only useful while fresh. Never touches money, reviews, tickets or the audit log. */
export async function purgeExpired(ctx: Ctx): Promise<{ sessions: number; codes: number; tickets: number; rateLimits: number; releasedEmails: number }> {
  const now = ctx.now();
  const count = async (sql: string, p: unknown[]) => (await ctx.db.query(sql, p)).length;
  return {
    sessions: await count("delete from sessions where expires_at <= $1 returning id", [now]),
    codes: await count("delete from auth_codes where expires_at <= $1 returning key", [new Date(now.getTime() - DAY_MS)]),
    tickets: await count("delete from auth_tickets where expires_at <= $1 returning token_hash", [now]),
    rateLimits: await count("delete from rate_limits where window_start <= $1 returning key", [new Date(now.getTime() - 2 * DAY_MS)]),
    releasedEmails: await releaseDeletedEmails(ctx)
  };
}

/**
 * Frees the emails of accounts deleted at least 30 days ago, so the address can sign up again. The identity rows stay (claims,
 * ledger and reviews keep pointing at them); they are only marked released and ignored by every sign-in and sign-up lookup.
 */
export async function releaseDeletedEmails(ctx: Ctx): Promise<number> {
  const now = ctx.now();
  return ctx.db.tx(async (t) => {
    const rows = await t.query<{ id: string }>(
      `update identities set released_at = $1 where released_at is null and user_id in (
         select id from users where workspace_id = $2 and status = 'deleted' and deleted_at <= $3) returning id`,
      [now, ctx.cfg.workspaceId, new Date(now.getTime() - EMAIL_RELEASE_DAYS * DAY_MS)]);
    if (rows.length) await audit(t, ctx, null, "user.release_emails", undefined, { count: rows.length });
    return rows.length;
  });
}

/**
 * Monthly: deletes uploads older than 30 days that no submission, payment or ticket message uses (someone uploaded a
 * screenshot and never sent it). A file that is referenced is never touched; the database refuses it anyway.
 */
export async function purgeUnusedFiles(ctx: Ctx): Promise<number> {
  const cutoff = new Date(ctx.now().getTime() - UNUSED_FILE_DAYS * DAY_MS);
  let removed = 0;
  for (;;) {
    const gone = await ctx.db.query<{ storage_key: string }>(
      `delete from files f where f.id in (
         select id from files x where x.workspace_id = $1 and x.created_at <= $2
           and not exists (select 1 from submissions s where s.file_id = x.id)
           and not exists (select 1 from payout_payments p where p.proof_file_id = x.id)
           and not exists (select 1 from ticket_messages m where m.attachment_file_id = x.id)
         limit 200 for update skip locked)
       returning f.storage_key`, [ctx.cfg.workspaceId, cutoff]);
    for (const f of gone) {
      // The row is already gone, so a leftover on disk is harmless; it is only logged.
      try { await ctx.storage.delete(f.storage_key); } catch { logEvent("warn", "files.delete_failed", {}); }
    }
    removed += gone.length;
    if (gone.length < 200) return removed;
  }
}
