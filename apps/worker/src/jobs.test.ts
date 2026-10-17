import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestCtx, makeAdmin, makeTask, makeUser, type TestCtx } from "@rr/server/testing";
import { claimTask, listClaims } from "@rr/server";
import { runExpire, runReconcile, work } from "./jobs";

describe("worker jobs", () => {
  let ctx: TestCtx;
  beforeAll(async () => { ctx = await createTestCtx("pglite"); });
  afterAll(() => ctx.close());

  it("expires overdue claims and says how many", async () => {
    const admin = await makeAdmin(ctx); const u = await makeUser(ctx);
    await claimTask(ctx, u.userId, await makeTask(ctx, admin, { timerMinutes: 5 }), u.identityId);
    const lines: string[] = [];
    ctx.clock.advance(6 * 60_000);
    expect(await runExpire(ctx, (e) => lines.push(e))).toBeGreaterThanOrEqual(1);
    expect((await listClaims(ctx, u.userId))[0]!.status).toBe("expired");
    expect(lines).toContain("claims.expired");
  });

  it("reconcile logs a clean bill, and shouts when something is wrong", async () => {
    const lines: { e: string; d?: Record<string, unknown> }[] = [];
    expect((await runReconcile(ctx, (e, d) => lines.push({ e, d }))).ok).toBe(true);
    const t = await makeTask(ctx, await makeAdmin(ctx), { slotsTotal: 1 });
    for (let i = 0; i < 2; i++) { const u = await makeUser(ctx); await ctx.db.query("insert into task_claims (workspace_id, template_id, user_id, identity_id, reward_paise) values ($1,$2,$3,$4,100)", [ctx.cfg.workspaceId, t, u.userId, u.identityId]); }
    expect((await runReconcile(ctx, (e, d) => lines.push({ e, d }))).ok).toBe(false);
    expect(lines.at(-1)!.e).toBe("reconcile.PROBLEMS");
    await ctx.db.query("update task_claims set status = 'void' where template_id = $1", [t]);
  });

  it("the loop runs each job on its schedule, survives a failing job, and stops when told", async () => {
    const log: { e: string; d?: Record<string, unknown> }[] = [];
    const stop = new AbortController();
    let t = 0;
    let broken = true;
    const flaky = { ...ctx, db: { ...ctx.db, query: (sql: string, p?: readonly unknown[]) => (broken && sql.includes("delete from sessions") ? Promise.reject(new Error("db blip")) : ctx.db.query(sql, p)), tx: ctx.db.tx.bind(ctx.db), exec: ctx.db.exec.bind(ctx.db), close: ctx.db.close.bind(ctx.db) } } as unknown as TestCtx;
    let loops = 0;
    await work(flaky, (e, d) => log.push({ e, ...(d ? { d } : {}) }), stop.signal, { expireEveryMs: 1000, purgeEveryMs: 3000, reconcileEveryMs: 100_000 }, {
      now: () => t,
      sleep: async (ms) => { t += ms; loops++; if (loops === 3) broken = false; if (loops > 8) stop.abort(); }
    });
    const events = log.map((l) => l.e);
    expect(events[0]).toBe("worker.start");
    expect(events.at(-1)).toBe("worker.stop");
    expect(events).toContain("job.failed");     // the purge hit a blip...
    expect(events).toContain("housekeeping");   // ...and worked on its next turn
    expect(events).toContain("reconcile.ok");
    expect(events.filter((e) => e === "reconcile.ok")).toHaveLength(1); // not again until its schedule
  });
});
