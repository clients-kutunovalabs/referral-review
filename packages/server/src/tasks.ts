import {
  type AdminTaskDetail, type AdminTaskRow, type AiConfig, type NewTaskInput, type Task, type TaskStatus, type TextMode
} from "@rr/core";
import type { Queryable } from "@rr/db";
import { audit } from "./audit";
import type { Ctx } from "./ctx";
import { shuffle } from "./crypto";
import { fail, notFound } from "./errors";
import { needs, type AdminActor } from "./rbac";

const DAY = 24 * 3_600_000;
export const LIVE_CLAIMS = "status not in ('expired', 'void')";

interface TemplateRow {
  id: string; title: string; description: string; site_url: string; reward_paise: bigint; slots_total: number | null;
  timer_minutes: number | null; active_until: Date | null; status: "active" | "paused" | "removed"; keywords: string[];
  text_mode: TextMode; ai_config: AiConfig | null; max_claims_per_account: number | null; claimed: number;
}

/** What a task looks like right now: closed when its slots are used up or its end date passed, closing soon in the last day. */
export function deriveStatus(t: Pick<TemplateRow, "status" | "slots_total" | "active_until" | "claimed">, now: Date): TaskStatus {
  if (t.status === "removed") return "removed";
  if (t.status === "paused") return "paused";
  if (t.slots_total !== null && t.claimed >= t.slots_total) return "closed";
  if (t.active_until) {
    const left = t.active_until.getTime() - now.getTime();
    if (left <= 0) return "closed";
    if (left < DAY) return "closing_soon";
  }
  return "active";
}

const SELECT = `select t.id, t.title, t.description, t.site_url, t.reward_paise, t.slots_total, t.timer_minutes, t.active_until, t.status,
  t.keywords, t.text_mode, t.ai_config, t.max_claims_per_account,
  (select count(*) from task_claims c where c.template_id = t.id and c.${LIVE_CLAIMS})::int as claimed
  from task_templates t`;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function toTask(r: TemplateRow, now: Date): Task {
  return {
    id: r.id, title: r.title, description: r.description, siteUrl: r.site_url, reward: r.reward_paise,
    slotsTotal: r.slots_total, slotsRemaining: r.slots_total === null ? null : Math.max(r.slots_total - r.claimed, 0),
    timerMinutes: r.timer_minutes, activeUntil: iso(r.active_until), status: deriveStatus(r, now), keywords: r.keywords,
    textMode: r.text_mode, ...(r.ai_config ? { aiConfig: r.ai_config } : {}), maxClaimsPerAccount: r.max_claims_per_account
  };
}

/** The worker's board: live tasks first, then the most recently closed. Paused and removed tasks are hidden. */
export async function listBoard(ctx: Ctx, q: Queryable = ctx.db): Promise<Task[]> {
  const now = ctx.now();
  const rows = await q.query<TemplateRow>(`${SELECT} where t.workspace_id = $1 and t.status = 'active' order by t.created_at desc limit 200`, [ctx.cfg.workspaceId]);
  const tasks = rows.map((r) => toTask(r, now));
  const open = tasks.filter((t) => t.status !== "closed");
  const closed = tasks.filter((t) => t.status === "closed").slice(0, 10);
  return [...open, ...closed];
}

/* ---------- admin ---------- */

function toRow(r: TemplateRow, now: Date): AdminTaskRow {
  return {
    id: r.id, title: r.title, reward: r.reward_paise, slotsTotal: r.slots_total, claimed: r.claimed, timerMinutes: r.timer_minutes,
    activeUntil: iso(r.active_until), textMode: r.text_mode, status: deriveStatus(r, now)
  };
}

export async function listAdminTasks(ctx: Ctx, actor: AdminActor): Promise<AdminTaskRow[]> {
  needs(actor, "task.manage", "task_text.manage");
  const now = ctx.now();
  const rows = await ctx.db.query<TemplateRow>(`${SELECT} where t.workspace_id = $1 order by t.created_at desc limit 500`, [ctx.cfg.workspaceId]);
  return rows.map((r) => toRow(r, now));
}

export async function getAdminTask(ctx: Ctx, actor: AdminActor, id: string): Promise<AdminTaskDetail> {
  needs(actor, "task.manage", "task_text.manage");
  const [r] = await ctx.db.query<TemplateRow>(`${SELECT} where t.id = $1 and t.workspace_id = $2`, [id, ctx.cfg.workspaceId]);
  if (!r) return notFound("Task");
  const scripts = await ctx.db.query<{ body: string }>("select body from task_texts where template_id = $1 order by seq", [id]);
  return {
    ...toRow(r, ctx.now()), description: r.description, siteUrl: r.site_url, keywords: r.keywords,
    ...(r.ai_config ? { aiConfig: r.ai_config } : {}), maxClaimsPerAccount: r.max_claims_per_account, scripts: scripts.map((s) => s.body)
  };
}

/** Every rule the New task form enforces, again, on the server. */
export function validateNewTask(i: NewTaskInput, now: Date): string[] {
  const e: string[] = [];
  if (!i.title.trim()) e.push("Title is required.");
  if (i.title.length > 200) e.push("Title is too long.");
  if (!i.description.trim()) e.push("Instructions are required.");
  if (!/^https:\/\/\S+\.\S+/.test(i.siteUrl)) e.push("Site link must be a valid https URL.");
  if (i.reward <= 0n) e.push("Reward must be more than zero.");
  if (i.slotsTotal !== null && (!Number.isInteger(i.slotsTotal) || i.slotsTotal < 1)) e.push("Total slots must be a whole number or blank.");
  if (i.timerMinutes !== null && (!Number.isInteger(i.timerMinutes) || i.timerMinutes < 1)) e.push("Time limit must be at least one minute, or blank for unlimited.");
  if (i.activeUntil !== null && !(Date.parse(i.activeUntil) > now.getTime())) e.push("Active till must be in the future.");
  if (i.maxClaimsPerAccount !== null && (!Number.isInteger(i.maxClaimsPerAccount) || i.maxClaimsPerAccount < 1)) e.push("Claim cap must be a whole number or blank.");
  const scripts = i.scripts.map((s) => s.trim()).filter(Boolean);
  if (i.textMode === "keywords" && i.keywords.length === 0) e.push("Add at least one keyword.");
  if (i.textMode === "manual_pool" && scripts.length === 0) e.push("Add at least one script.");
  if (i.textMode === "ai_generated") {
    const a = i.aiConfig;
    if (i.description.trim().length < 20) e.push("AI needs a task description of at least 20 characters.");
    if (i.keywords.length === 0) e.push("AI needs at least one keyword.");
    if (!a || !a.tone) e.push("AI: choose a tone.");
    if (!a || !a.language.trim()) e.push("AI: enter a language.");
    if (!a || !a.style) e.push("AI: choose a script style.");
    if (!a || !Number.isInteger(a.minWords) || !Number.isInteger(a.maxWords) || a.minWords < 10 || a.maxWords < a.minWords) e.push("AI: set word limits (min 10, max at least min).");
  }
  return e;
}

export async function createTask(ctx: Ctx, actor: AdminActor, input: NewTaskInput): Promise<AdminTaskRow> {
  needs(actor, "task.manage");
  const errors = validateNewTask(input, ctx.now());
  if (input.textMode === "ai_generated" && !ctx.cfg.aiEnabled) errors.push("AI scripts are not enabled on this site.");
  if (errors.length) fail("bad_request", errors.join(" "));
  const keywords = input.textMode === "none" || input.textMode === "manual_pool" ? [] : [...new Set(input.keywords.map((k) => k.trim()).filter(Boolean))];
  const scripts = input.textMode === "manual_pool" ? input.scripts.map((s) => s.trim()).filter(Boolean) : [];
  return ctx.db.tx(async (t) => {
    const [r] = await t.query<{ id: string }>(
      `insert into task_templates (workspace_id, title, description, site_url, reward_paise, slots_total, timer_minutes, active_until, keywords, text_mode, ai_config, max_claims_per_account, created_by, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) returning id`,
      [ctx.cfg.workspaceId, input.title.trim(), input.description.trim(), input.siteUrl, input.reward, input.slotsTotal, input.timerMinutes, input.activeUntil,
       keywords, input.textMode, input.textMode === "ai_generated" ? JSON.stringify(input.aiConfig) : null, input.maxClaimsPerAccount, actor.userId, ctx.now()]);
    const id = r!.id;
    if (scripts.length) await insertScripts(t, ctx, id, scripts);
    await audit(t, ctx, actor.userId, "task.create", { type: "task", id }, { title: input.title, reward: input.reward, textMode: input.textMode });
    const [row] = await t.query<TemplateRow>(`${SELECT} where t.id = $1`, [id]);
    return toRow(row!, ctx.now());
  });
}

export async function setTaskStatus(ctx: Ctx, actor: AdminActor, id: string, status: "active" | "paused" | "removed"): Promise<void> {
  needs(actor, "task.manage");
  await ctx.db.tx(async (t) => {
    const [cur] = await t.query<{ status: string }>("select status from task_templates where id = $1 and workspace_id = $2 for update", [id, ctx.cfg.workspaceId]);
    if (!cur) return notFound("Task");
    if (cur.status === "removed") fail("conflict", "A removed task cannot be changed.", 409);
    await t.query("update task_templates set status = $2, updated_at = $3 where id = $1", [id, status, ctx.now()]);
    let voided = 0;
    if (status === "removed") {
      // Workers who claimed it but have not submitted lose the claim. Submissions already waiting for review are still processed.
      const rows = await t.query("update task_claims set status = 'void', ended_at = $2 where template_id = $1 and status = 'claimed' returning id", [id, ctx.now()]);
      voided = rows.length;
    }
    await audit(t, ctx, actor.userId, `task.${status === "active" ? "resume" : status === "paused" ? "pause" : "remove"}`, { type: "task", id }, { voidedClaims: voided });
  });
}

/* ---------- the script bag ---------- */

/** Stores scripts and mixes them into the bag at random places, so the hand-out stays balanced as scripts are added. */
async function insertScripts(t: Queryable, ctx: Ctx, templateId: string, bodies: string[]): Promise<void> {
  const ids: string[] = [];
  for (const body of bodies) {
    const [r] = await t.query<{ id: string }>("insert into task_texts (workspace_id, template_id, body, created_at) values ($1,$2,$3,$4) returning id", [ctx.cfg.workspaceId, templateId, body, ctx.now()]);
    ids.push(r!.id);
  }
  const waiting = (await t.query<{ text_id: string }>("select text_id from template_text_bag where template_id = $1", [templateId])).map((r) => r.text_id);
  await writeBag(t, templateId, shuffle([...waiting, ...ids]));
}

async function writeBag(t: Queryable, templateId: string, ordered: string[]): Promise<void> {
  await t.query("delete from template_text_bag where template_id = $1", [templateId]);
  for (let position = 0; position < ordered.length; position++) {
    await t.query("insert into template_text_bag (template_id, position, text_id) values ($1,$2,$3)", [templateId, position, ordered[position]]);
  }
}

export async function addScripts(ctx: Ctx, actor: AdminActor, id: string, bodies: string[]): Promise<string[]> {
  needs(actor, "task_text.manage");
  const clean = bodies.map((b) => b.trim()).filter(Boolean);
  if (!clean.length) fail("bad_request", "Add at least one script.");
  return ctx.db.tx(async (t) => {
    const [tpl] = await t.query<{ text_mode: TextMode }>("select text_mode from task_templates where id = $1 and workspace_id = $2 for update", [id, ctx.cfg.workspaceId]);
    if (!tpl) return notFound("Task");
    if (tpl.text_mode !== "manual_pool") fail("bad_request", "This task does not use manual scripts.");
    await insertScripts(t, ctx, id, clean);
    await audit(t, ctx, actor.userId, "task.add_scripts", { type: "task", id }, { count: clean.length });
    return (await t.query<{ body: string }>("select body from task_texts where template_id = $1 order by seq", [id])).map((r) => r.body);
  });
}

/**
 * Hands out the next script. The caller holds the template row lock, so two workers can never take the same slot.
 * When the bag is empty it is refilled with every script in a fresh random order: with N scripts and M claimers each
 * script is used floor(M/N) or ceil(M/N) times.
 */
export async function drawScript(t: Queryable, templateId: string): Promise<string | null> {
  let [next] = await t.query<{ position: number; text_id: string }>("select position, text_id from template_text_bag where template_id = $1 order by position limit 1", [templateId]);
  if (!next) {
    const all = (await t.query<{ id: string }>("select id from task_texts where template_id = $1", [templateId])).map((r) => r.id);
    if (!all.length) return null;
    await writeBag(t, templateId, shuffle(all));
    [next] = await t.query<{ position: number; text_id: string }>("select position, text_id from template_text_bag where template_id = $1 order by position limit 1", [templateId]);
  }
  await t.query("delete from template_text_bag where template_id = $1 and position = $2", [templateId, next!.position]);
  const [text] = await t.query<{ body: string }>("select body from task_texts where id = $1", [next!.text_id]);
  return text?.body ?? null;
}
