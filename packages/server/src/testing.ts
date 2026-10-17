import { createMockAi } from "@rr/ai";
import { createOutbox, type InMemoryOutbox } from "@rr/auth";
import { PERMISSIONS, type NewTaskInput, type PermissionKey } from "@rr/core";
import { DEFAULT_WORKSPACE_ID } from "@rr/db";
import { createTestDb, engines, type Engine, type TestDb } from "@rr/db/testing";
import { createMockStorage } from "@rr/storage";
import { claimTask } from "./claims";
import type { Ctx } from "./ctx";
import { loadAdmin, type AdminActor } from "./rbac";
import { decide, submitProof } from "./submissions";
import { saveUpload } from "./files";
import { createTask } from "./tasks";

export { engines, type Engine };

export interface TestCtx extends Ctx {
  clock: { advance(ms: number): void; set(d: Date): void };
  outbox: InMemoryOutbox;
  close(): Promise<void>;
  engine: Engine;
}

export async function createTestCtx(engine: Engine): Promise<TestCtx> {
  const t: TestDb = await createTestDb(engine);
  let now = Date.now();
  const outbox = createOutbox();
  return {
    db: t.db,
    cfg: {
      workspaceId: DEFAULT_WORKSPACE_ID, upiKey: Buffer.alloc(32, 7), secret: "test-secret-test-secret-test-secret-0000",
      baseUrl: "https://tasks.test", trustProxyHops: 1, sessionIdleHours: 168, maxIdentitiesPerUser: 10, aiEnabled: true
    } as Ctx["cfg"],
    storage: createMockStorage(), ai: createMockAi(), email: outbox,
    now: () => new Date(now),
    clock: { advance: (ms) => { now += ms; }, set: (d) => { now = d.getTime(); } },
    outbox, engine, close: t.close
  };
}

let seq = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export interface TestUser { userId: string; identityId: string; email: string; name: string }

/** A worker with one main email, created directly (no password: tests that need sign-in use the auth flow). */
export async function makeUser(ctx: Ctx, name = uniq("user")): Promise<TestUser> {
  const email = `${name.toLowerCase().replace(/\W/g, "")}@test.co`;
  const [u] = await ctx.db.query<{ id: string }>("insert into users (workspace_id, name) values ($1,$2) returning id", [ctx.cfg.workspaceId, name]);
  const [i] = await ctx.db.query<{ id: string }>("insert into identities (workspace_id, user_id, email, is_primary) values ($1,$2,$3,true) returning id", [ctx.cfg.workspaceId, u!.id, email]);
  return { userId: u!.id, identityId: i!.id, email, name };
}

export async function addIdentityDirect(ctx: Ctx, userId: string, email = `${uniq("alt")}@test.co`): Promise<string> {
  const [i] = await ctx.db.query<{ id: string }>("insert into identities (workspace_id, user_id, email) values ($1,$2,$3) returning id", [ctx.cfg.workspaceId, userId, email]);
  return i!.id;
}

/** An admin holding exactly these permissions ("all" makes an owner). */
export async function makeAdmin(ctx: Ctx, perms: PermissionKey[] | "all" = "all", name = uniq("admin")): Promise<AdminActor> {
  const u = await makeUser(ctx, name);
  const owner = perms === "all";
  await ctx.db.query("insert into admin_members (user_id, workspace_id, is_owner) values ($1,$2,$3)", [u.userId, ctx.cfg.workspaceId, false]);
  if (!owner) {
    const [r] = await ctx.db.query<{ id: string }>("insert into roles (workspace_id, name) values ($1,$2) returning id", [ctx.cfg.workspaceId, uniq("role")]);
    for (const p of perms) await ctx.db.query("insert into role_permissions (role_id, permission) values ($1,$2)", [r!.id, p]);
    await ctx.db.query("insert into member_roles (user_id, role_id) values ($1,$2)", [u.userId, r!.id]);
  } else {
    const [r] = await ctx.db.query<{ id: string }>("insert into roles (workspace_id, name) values ($1,$2) returning id", [ctx.cfg.workspaceId, uniq("everything")]);
    for (const p of PERMISSIONS) await ctx.db.query("insert into role_permissions (role_id, permission) values ($1,$2)", [r!.id, p.key]);
    await ctx.db.query("insert into member_roles (user_id, role_id) values ($1,$2)", [u.userId, r!.id]);
  }
  return (await loadAdmin(ctx.db, u.userId)) as AdminActor;
}

export const taskInput = (o: Partial<NewTaskInput> = {}): NewTaskInput => ({
  title: uniq("Task "), description: "Reach out to a prospect and screenshot the chat.", siteUrl: "https://example.com/task", reward: 4000n,
  slotsTotal: null, timerMinutes: 30, activeUntil: null, textMode: "none", keywords: [], scripts: [], maxClaimsPerAccount: null, ...o
});

export async function makeTask(ctx: Ctx, admin: AdminActor, o: Partial<NewTaskInput> = {}): Promise<string> {
  return (await createTask(ctx, admin, taskInput(o))).id;
}

/** The smallest bytes that pass the PNG check. */
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3, 4]);

/** Runs a whole worker journey up to a pending submission and returns its id. */
export async function submitted(ctx: Ctx, user: TestUser, taskId: string, note = ""): Promise<{ claimId: string; submissionId: string }> {
  const claim = await claimTask(ctx, user.userId, taskId, user.identityId);
  const { fileId } = await saveUpload(ctx, user.userId, "proof", PNG);
  await submitProof(ctx, user.userId, claim.id, { fileId, note });
  const [s] = await ctx.db.query<{ id: string }>("select id from submissions where claim_id = $1", [claim.id]);
  return { claimId: claim.id, submissionId: s!.id };
}

/** Gives a worker spendable money by running a task through approval. */
export async function fund(ctx: Ctx, user: TestUser, reviewer: AdminActor, taskAdmin: AdminActor, rupees: bigint): Promise<void> {
  const taskId = await makeTask(ctx, taskAdmin, { reward: rupees * 100n });
  const { submissionId } = await submitted(ctx, user, taskId);
  await decide(ctx, reviewer, submissionId, 100, "Looks good.");
}
