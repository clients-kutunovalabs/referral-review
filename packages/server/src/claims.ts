import { errorText, logEvent } from "./log";
import type { AiConfig, Claim, ClaimStatus, TextStatus } from "@rr/core";
import { isUniqueViolation, type Queryable } from "@rr/db";
import { audit } from "./audit";
import type { Ctx } from "./ctx";
import { conflict, fail, forbidden, notFound } from "./errors";
import { LIVE_CLAIMS, deriveStatus, drawScript } from "./tasks";

interface ClaimRow {
  id: string; template_id: string; identity_id: string; identity_email: string; status: ClaimStatus; title: string; site_url: string;
  keywords: string[]; reward_paise: bigint; expires_at: Date | null; submitted_at: Date | null; assigned_text: string | null;
  text_status: TextStatus; ended_at: Date | null; outcome_pct: number | null; credited_paise: bigint | null; review_note: string | null; reviewed_at: Date | null;
}

const SELECT = `select c.id, c.template_id, c.identity_id, i.email as identity_email, c.status, t.title, t.site_url, t.keywords, c.reward_paise,
  c.expires_at, c.submitted_at, c.assigned_text, c.text_status, c.ended_at, r.outcome_pct, r.credited_paise, r.note as review_note, r.created_at as reviewed_at
  from task_claims c
  join task_templates t on t.id = c.template_id
  join identities i on i.id = c.identity_id
  left join submissions s on s.claim_id = c.id
  left join reviews r on r.submission_id = s.id`;

function toClaim(r: ClaimRow, now: Date): Claim {
  const ended = r.reviewed_at ?? r.ended_at;
  return {
    id: r.id, taskId: r.template_id, identityId: r.identity_id, identityEmail: r.identity_email, status: r.status,
    taskTitle: r.title, siteUrl: r.site_url, keywords: r.keywords, reward: r.reward_paise,
    ...(r.status === "claimed" && r.expires_at ? { minutesLeft: Math.max(Math.ceil((r.expires_at.getTime() - now.getTime()) / 60_000), 0), expiresAt: r.expires_at.toISOString() } : {}),
    ...(r.submitted_at ? { submittedAt: r.submitted_at.toISOString() } : {}),
    ...(ended && r.status !== "claimed" && r.status !== "under_review" ? { reviewedAt: ended.toISOString() } : {}),
    ...(r.assigned_text ? { assignedText: r.assigned_text } : {}),
    ...(r.text_status !== "none" ? { textStatus: r.text_status } : {}),
    ...(r.outcome_pct !== null ? { outcome: r.outcome_pct as Claim["outcome"] } : {}),
    ...(r.credited_paise !== null ? { credited: r.credited_paise } : {}),
    ...(r.review_note ? { reviewerNote: r.review_note } : {})
  };
}

export async function getClaim(ctx: Ctx, q: Queryable, claimId: string): Promise<Claim> {
  const [r] = await q.query<ClaimRow>(`${SELECT} where c.id = $1`, [claimId]);
  if (!r) return notFound("Claim");
  return toClaim(r, ctx.now());
}

export async function listClaims(ctx: Ctx, userId: string): Promise<Claim[]> {
  const now = ctx.now();
  const rows = await ctx.db.query<ClaimRow>(`${SELECT} where c.user_id = $1 order by c.claimed_at desc limit 500`, [userId]);
  return rows.map((r) => toClaim(r, now));
}

/**
 * Claims a task for one of the worker's emails. The task row is locked first, so however many workers press Claim at
 * once, the number of live claims never passes the slot count, and each takes a different script from the bag.
 */
export async function claimTask(ctx: Ctx, userId: string, taskId: string, identityId: string): Promise<Claim> {
  const claimId = await ctx.db.tx(async (t) => {
    const now = ctx.now();
    const [u] = await t.query<{ status: string }>("select status from users where id = $1", [userId]);
    if (!u || u.status !== "active") return fail("suspended", "This account cannot claim tasks.", 403);
    const [ident] = await t.query<{ id: string }>("select id from identities where id = $1 and user_id = $2", [identityId, userId]);
    if (!ident) return notFound("Email");

    const [tpl] = await t.query<{
      id: string; status: "active" | "paused" | "removed"; reward_paise: bigint; slots_total: number | null; timer_minutes: number | null;
      active_until: Date | null; text_mode: string; max_claims_per_account: number | null;
    }>("select id, status, reward_paise, slots_total, timer_minutes, active_until, text_mode, max_claims_per_account from task_templates where id = $1 and workspace_id = $2 for update", [taskId, ctx.cfg.workspaceId]);
    if (!tpl || tpl.status === "removed") return notFound("Task");
    // Claims whose timer ran out free their slot now, not at the worker's next sweep (up to a minute later).
    await t.query("update task_claims set status = 'expired', ended_at = $2 where template_id = $1 and status = 'claimed' and expires_at <= $2", [taskId, now]);

    // "same" counts every claim this email ever made on the task (one claim per email, ever); the account cap counts live claims.
    // Checked before the slots, so someone pressing Claim again on a task that has since filled up is told they already have it.
    const [mine] = await t.query<{ n: number; same: number }>(
      `select count(*) filter (where ${LIVE_CLAIMS})::int as n, count(*) filter (where identity_id = $2)::int as same from task_claims where template_id = $1 and user_id = $3`, [taskId, identityId, userId]);
    if (mine && mine.same > 0) return conflict("already_claimed", "You already claimed this task with this email.");
    const [{ claimed } = { claimed: 0 }] = await t.query<{ claimed: number }>(`select count(*)::int as claimed from task_claims where template_id = $1 and ${LIVE_CLAIMS}`, [taskId]);
    const state = deriveStatus({ status: tpl.status, slots_total: tpl.slots_total, active_until: tpl.active_until, claimed }, now);
    if (state === "paused") return fail("task_closed", "This task is paused right now.", 409);
    if (state === "closed") return tpl.slots_total !== null && claimed >= tpl.slots_total ? fail("slots_full", "All slots for this task are taken.", 409) : fail("task_closed", "This task has closed.", 409);
    if (tpl.max_claims_per_account !== null && mine && mine.n >= tpl.max_claims_per_account) return conflict("claim_limit", "You have reached the limit for this task.");

    let text: string | null = null; let source: "pool" | "ai" | null = null; let textStatus: TextStatus = "none";
    if (tpl.text_mode === "manual_pool") {
      text = await drawScript(t, taskId);
      if (text) { source = "pool"; textStatus = "ready"; }
    } else if (tpl.text_mode === "ai_generated") {
      textStatus = "pending";
    }
    const expires = tpl.timer_minutes === null ? null : new Date(now.getTime() + tpl.timer_minutes * 60_000);
    try {
      const [c] = await t.query<{ id: string }>(
        `insert into task_claims (workspace_id, template_id, user_id, identity_id, reward_paise, claimed_at, expires_at, assigned_text, text_source, text_status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [ctx.cfg.workspaceId, taskId, userId, identityId, tpl.reward_paise, now, expires, text, source, textStatus]);
      return c!.id;
    } catch (err) {
      if (isUniqueViolation(err)) return conflict("already_claimed", "You already claimed this task with this email.");
      throw err;
    }
  });
  // The AI call happens after the claim is saved and its lock released, so a slow provider never blocks other workers.
  const [pending] = await ctx.db.query<{ text_status: TextStatus }>("select text_status from task_claims where id = $1", [claimId]);
  if (pending?.text_status === "pending") await generateClaimText(ctx, claimId);
  return getClaim(ctx, ctx.db, claimId);
}

const AI_TIMEOUT_MS = 25_000;

/** Writes the AI script for a claim. Failure is recorded, not thrown: the worker keeps the claim and can retry. */
export async function generateClaimText(ctx: Ctx, claimId: string): Promise<void> {
  const [c] = await ctx.db.query<{ title: string; description: string; keywords: string[]; ai_config: AiConfig | null }>(
    `select t.title, t.description, t.keywords, t.ai_config from task_claims c join task_templates t on t.id = c.template_id where c.id = $1 and c.status = 'claimed'`, [claimId]);
  if (!c || !c.ai_config) { await ctx.db.query("update task_claims set text_status = 'failed' where id = $1 and text_status = 'pending'", [claimId]); return; }
  try {
    // Only the task's own fields and the AI settings go out. No worker name, email, phone or wallet data, ever.
    const request = { title: c.title, description: c.description, keywords: c.keywords, tone: c.ai_config.tone, language: c.ai_config.language, minWords: c.ai_config.minWords, maxWords: c.ai_config.maxWords, style: c.ai_config.style };
    const body = await Promise.race([
      ctx.ai.generateScript(request),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AI timed out")), AI_TIMEOUT_MS).unref?.())
    ]);
    const text = body.trim().slice(0, 5000);
    if (!text) throw new Error("AI returned nothing");
    await ctx.db.tx(async (t) => {
      const rows = await t.query("update task_claims set assigned_text = $2, text_source = 'ai', text_status = 'ready' where id = $1 and text_status = 'pending' returning id", [claimId, text]);
      if (rows.length) await audit(t, ctx, null, "claim.ai_text", { type: "claim", id: claimId }, { words: text.split(/\s+/).length });
    });
  } catch (err) {
    await ctx.db.query("update task_claims set text_status = 'failed' where id = $1 and text_status = 'pending'", [claimId]);
    logEvent("error", "ai.script_failed", { error: errorText(err) });
  }
}

export async function retryClaimText(ctx: Ctx, userId: string, claimId: string): Promise<Claim> {
  const rows = await ctx.db.query<{ id: string }>(
    "update task_claims set text_status = 'pending' where id = $1 and user_id = $2 and status = 'claimed' and text_status = 'failed' returning id", [claimId, userId]);
  if (!rows.length) {
    const [c] = await ctx.db.query<{ user_id: string }>("select user_id from task_claims where id = $1", [claimId]);
    if (!c) return notFound("Claim");
    if (c.user_id !== userId) return forbidden();
  } else {
    await generateClaimText(ctx, claimId);
  }
  return getClaim(ctx, ctx.db, claimId);
}

/** Time's up: claims past their deadline that were never submitted become expired, which frees the slot. Safe to run from several workers at once. */
export async function expireClaims(ctx: Ctx): Promise<number> {
  const now = ctx.now();
  let total = 0;
  for (;;) {
    const n = await ctx.db.tx(async (t) => {
      const rows = await t.query<{ id: string }>(
        `update task_claims set status = 'expired', ended_at = $1
         where id in (select id from task_claims where status = 'claimed' and expires_at <= $1 order by expires_at limit 500 for update skip locked)
         returning id`, [now]);
      if (rows.length) await audit(t, ctx, null, "claim.expire", undefined, { count: rows.length });
      return rows.length;
    });
    total += n;
    if (n < 500) return total;
  }
}
