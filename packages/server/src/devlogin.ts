import { OUTCOME_PERCENTS } from "@rr/money";
import { OWNER_ROLE_ID } from "@rr/db";
import { claimTask } from "./claims";
import type { Ctx } from "./ctx";
import { hashPassword } from "./crypto";
import { saveUpload } from "./files";
import { sessionCookie } from "./http/util";
import { loadAdmin } from "./rbac";
import { createSession } from "./sessions";
import { submitProof, decide } from "./submissions";
import { createTask } from "./tasks";
import { createTicket } from "./tickets";

/**
 * DEVELOPMENT ONLY. Signs a tester in as a demo worker or a demo admin with one click, with sample data to look at.
 * Never reachable in production: configuration refuses DEV_LOGIN there, and the web route double-checks.
 */
export const DEV_PASSWORD = "dev password 123";
export const DEV_ACCOUNTS = {
  worker: { email: "worker@dev.local", name: "Demo Worker", phone: "9876543210" },
  worker2: { email: "worker2@dev.local", name: "Second Worker", phone: "9876500000" },
  admin: { email: "admin@dev.local", name: "Demo Admin" }
} as const;

// A 1x1 PNG, so the demo screenshots are real images.
const PIXEL = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

async function ensureUser(ctx: Ctx, a: { email: string; name: string; phone?: string }): Promise<{ userId: string; identityId: string }> {
  const [found] = await ctx.db.query<{ user_id: string; id: string }>("select user_id, id from identities where workspace_id = $1 and lower(email) = $2 and released_at is null", [ctx.cfg.workspaceId, a.email]);
  if (found) return { userId: found.user_id, identityId: found.id };
  const hash = await hashPassword(DEV_PASSWORD);
  return ctx.db.tx(async (t) => {
    const now = ctx.now();
    const [u] = await t.query<{ id: string }>("insert into users (workspace_id, name, phone, created_at) values ($1,$2,$3,$4) returning id", [ctx.cfg.workspaceId, a.name, a.phone ?? null, now]);
    const [i] = await t.query<{ id: string }>("insert into identities (workspace_id, user_id, email, is_primary, verified_at, created_at) values ($1,$2,$3,true,$4,$4) returning id", [ctx.cfg.workspaceId, u!.id, a.email, now]);
    await t.query("insert into auth_credentials (user_id, password_hash, updated_at) values ($1,$2,$3)", [u!.id, hash, now]);
    return { userId: u!.id, identityId: i!.id };
  });
}

/** Sample tasks, one paid-for submission (so the worker has a balance) and one waiting for review, one open ticket. Created once. */
async function ensureDemoData(ctx: Ctx): Promise<void> {
  const [done] = await ctx.db.query<{ n: number }>("select count(*)::int as n from task_templates where workspace_id = $1 and title like 'Demo:%'", [ctx.cfg.workspaceId]);
  if (done!.n > 0) return;
  const adminUser = await ensureUser(ctx, DEV_ACCOUNTS.admin);
  await ctx.db.query("insert into admin_members (user_id, workspace_id, is_owner) values ($1,$2,false) on conflict (user_id) do nothing", [adminUser.userId, ctx.cfg.workspaceId]);
  await ctx.db.query("insert into member_roles (user_id, role_id) values ($1,$2) on conflict do nothing", [adminUser.userId, OWNER_ROLE_ID]);
  const admin = (await loadAdmin(ctx.db, adminUser.userId))!;
  const w1 = await ensureUser(ctx, DEV_ACCOUNTS.worker);
  const w2 = await ensureUser(ctx, DEV_ACCOUNTS.worker2);

  const base = { description: "Send the message below to a prospect on the site and take a screenshot of the chat.", siteUrl: "https://example.com/outreach", slotsTotal: null, timerMinutes: 60, activeUntil: null, textMode: "manual_pool" as const, keywords: ["demo"], maxClaimsPerAccount: null };
  const scripts = ["Hi! I came across your shop and loved the range. Could we talk about a partnership?", "Hello, quick question about your listing. Is it still available?", "Hey, I help small shops get more visitors. Can I share a free tip?"];
  const t1 = await createTask(ctx, admin, { ...base, title: "Demo: Cold outreach message", reward: 4000n, scripts });
  await createTask(ctx, admin, { ...base, title: "Demo: Follow-up call script", reward: 6000n, scripts, textMode: "none", keywords: [] });
  await createTask(ctx, admin, { ...base, title: "Demo: Product review (50 slots)", reward: 2500n, scripts: [], textMode: "none", slotsTotal: 50, keywords: [] });

  // worker 1: one task approved in full, so there is money to withdraw
  const c1 = await claimTask(ctx, w1.userId, t1.id, w1.identityId);
  await submitProof(ctx, w1.userId, c1.id, { fileId: (await saveUpload(ctx, w1.userId, "proof", PIXEL)).fileId, note: "Sent it, demo keyword included." });
  const [s1] = await ctx.db.query<{ id: string }>("select id from submissions where claim_id = $1", [c1.id]);
  await decide(ctx, admin, s1!.id, OUTCOME_PERCENTS[0], "Looks good. Paid in full.");

  // worker 2: one submission waiting in the review queue and an open support ticket
  const c2 = await claimTask(ctx, w2.userId, t1.id, w2.identityId);
  await submitProof(ctx, w2.userId, c2.id, { fileId: (await saveUpload(ctx, w2.userId, "proof", PIXEL)).fileId, note: "Done, screenshot attached." });
  await createTicket(ctx, w2.userId, { title: "Where is my payout?", body: "I asked for a payout two days ago and it still shows processing." });
}

/** Signs in as the demo worker or admin. Returns the Set-Cookie value and where to send the browser. */
export async function devLogin(ctx: Ctx, as: "worker" | "admin"): Promise<{ cookie: string; location: string }> {
  await ensureDemoData(ctx);
  const who = await ensureUser(ctx, as === "admin" ? DEV_ACCOUNTS.admin : DEV_ACCOUNTS.worker);
  const s = await createSession(ctx, who.userId, { userAgent: "dev-login" });
  return { cookie: sessionCookie(ctx, s.token, s.expiresAt), location: as === "admin" ? "/admin" : "/app" };
}
