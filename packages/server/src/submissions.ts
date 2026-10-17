import { type OutcomePercent, outcomeAmount } from "@rr/money";
import type { ReviewQueueItem } from "@rr/core";
import type { Ctx } from "./ctx";
import { audit } from "./audit";
import { conflict, fail, forbidden, notFound } from "./errors";
import { fileUrl } from "./files";
import { matchKeywords } from "./keywords";
import { maskEmail } from "./crypto";
import { needs, type AdminActor } from "./rbac";

const NOTE_MAX = 2000;

/** The worker hands in a screenshot (already uploaded) and an optional note. The claim moves to Under review. */
export async function submitProof(ctx: Ctx, userId: string, claimId: string, input: { fileId: string; note?: string | null }): Promise<void> {
  const note = (input.note ?? "").trim();
  if (note.length > NOTE_MAX) fail("bad_request", `The note is too long (max ${NOTE_MAX} characters).`);
  // The "too late" outcome is returned, not thrown, so the expiry it records is committed rather than rolled back.
  const outcome = await ctx.db.tx(async (t): Promise<"ok" | "expired"> => {
    const now = ctx.now();
    const [c] = await t.query<{ user_id: string; status: string; expires_at: Date | null; template_id: string }>(
      "select user_id, status, expires_at, template_id from task_claims where id = $1 for update", [claimId]);
    if (!c) return notFound("Claim");
    if (c.user_id !== userId) return forbidden();
    if (c.status !== "claimed") return conflict("conflict", c.status === "expired" ? "The timer ran out for this task." : "This task was already submitted or ended.");
    if (c.expires_at && c.expires_at <= now) {
      await t.query("update task_claims set status = 'expired', ended_at = $2 where id = $1", [claimId, now]);
      return "expired";
    }
    const [u] = await t.query<{ status: string }>("select status from users where id = $1", [userId]);
    if (u?.status !== "active") return fail("suspended", "This account cannot submit work.", 403);
    const [f] = await t.query<{ id: string }>(
      "select f.id from files f where f.id = $1 and f.owner_user_id = $2 and f.kind = 'proof' and not exists (select 1 from submissions s where s.file_id = f.id)", [input.fileId, userId]);
    if (!f) return fail("upload_invalid", "Attach a screenshot first.");
    const [tpl] = await t.query<{ keywords: string[] }>("select keywords from task_templates where id = $1", [c.template_id]);
    await t.query("insert into submissions (workspace_id, claim_id, file_id, note, keywords_matched, submitted_at) values ($1,$2,$3,$4,$5,$6)",
      [ctx.cfg.workspaceId, claimId, input.fileId, note || null, matchKeywords(note, tpl?.keywords ?? []), now]);
    await t.query("update task_claims set status = 'under_review', submitted_at = $2 where id = $1", [claimId, now]);
    return "ok";
  });
  if (outcome === "expired") conflict("conflict", "The timer ran out for this task.");
}

interface QueueRow {
  id: string; worker: string; email: string; title: string; reward_paise: bigint; submitted_at: Date; claimed_at: Date; timer_minutes: number | null;
  note: string | null; keywords: string[]; keywords_matched: string[]; assigned_text: string | null; file_id: string;
}

export async function reviewQueue(ctx: Ctx, actor: AdminActor): Promise<ReviewQueueItem[]> {
  needs(actor, "review.decide");
  const now = ctx.now();
  const rows = await ctx.db.query<QueueRow>(
    `select s.id, u.name as worker, i.email, t.title, c.reward_paise, s.submitted_at, c.claimed_at, t.timer_minutes, s.note, t.keywords,
            s.keywords_matched, c.assigned_text, s.file_id
     from submissions s
     join task_claims c on c.id = s.claim_id join task_templates t on t.id = c.template_id
     join users u on u.id = c.user_id join identities i on i.id = c.identity_id
     where s.workspace_id = $1 and s.status = 'pending' order by s.submitted_at limit 500`, [ctx.cfg.workspaceId]);
  return rows.map((r) => ({
    id: r.id, worker: r.worker, identityEmail: maskEmail(r.email), taskTitle: r.title, reward: r.reward_paise,
    submittedAt: r.submitted_at.toISOString(), waitingMinutes: Math.max(Math.floor((now.getTime() - r.submitted_at.getTime()) / 60_000), 0),
    timeLimitMinutes: r.timer_minutes, timeTakenMinutes: Math.max(Math.round((r.submitted_at.getTime() - r.claimed_at.getTime()) / 60_000), 0),
    ...(r.note ? { workerNote: r.note } : {}), keywords: r.keywords, keywordsMatched: r.keywords_matched,
    ...(r.assigned_text ? { assignedText: r.assigned_text } : {}), ...(fileUrl(r.file_id) ? { proofUrl: fileUrl(r.file_id) as string } : {})
  }));
}

/**
 * The reviewer's decision. In one transaction: the submission row is locked (so two reviewers cannot both decide),
 * the review is recorded, the claim gets its final status and, when anything is owed, one ledger credit is written.
 */
export async function decide(ctx: Ctx, actor: AdminActor, submissionId: string, pct: OutcomePercent, note: string): Promise<void> {
  needs(actor, "review.decide");
  const text = note.trim();
  if (!text) fail("bad_request", "A note is required for every outcome.");
  await ctx.db.tx(async (t) => {
    const now = ctx.now();
    const [s] = await t.query<{ status: string; claim_id: string }>("select status, claim_id from submissions where id = $1 and workspace_id = $2 for update", [submissionId, ctx.cfg.workspaceId]);
    if (!s) return notFound("Submission");
    if (s.status !== "pending") return conflict("not_pending", "Someone already reviewed this submission.");
    const [c] = await t.query<{ user_id: string; identity_id: string; reward_paise: bigint }>("select user_id, identity_id, reward_paise from task_claims where id = $1", [s.claim_id]);
    const credit = outcomeAmount(c!.reward_paise, pct);
    await t.query("insert into reviews (workspace_id, submission_id, reviewer_id, outcome_pct, note, credited_paise, created_at) values ($1,$2,$3,$4,$5,$6,$7)",
      [ctx.cfg.workspaceId, submissionId, actor.userId, pct, text, credit, now]);
    await t.query("update submissions set status = 'reviewed' where id = $1", [submissionId]);
    await t.query("update task_claims set status = $2, ended_at = $3 where id = $1", [s.claim_id, pct === 100 ? "approved" : pct === 0 ? "rejected" : "partial", now]);
    if (credit > 0n) {
      await t.query("insert into wallet_transactions (workspace_id, user_id, identity_id, kind, amount_paise, submission_id, created_at) values ($1,$2,$3,'credit',$4,$5,$6)",
        [ctx.cfg.workspaceId, c!.user_id, c!.identity_id, credit, submissionId, now]);
    }
    await audit(t, ctx, actor.userId, "review.decide", { type: "submission", id: submissionId }, { outcome: pct, credited: credit, reward: c!.reward_paise });
  });
}
