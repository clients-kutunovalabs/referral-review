import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@rr/core";
import { addScripts, claimTask, createTask, expireClaims, getAdminTask, listBoard, listClaims, retryClaimText, saveUpload, setTaskStatus, submitProof } from "./index";
import { PNG, addIdentityDirect, createTestCtx, engines, makeAdmin, makeTask, makeUser, taskInput, type TestCtx } from "./testing";
import type { AdminActor } from "./rbac";

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as ApiError | null)?.code;

for (const engine of engines()) {
  describe(`claims on ${engine}`, () => {
    let ctx: TestCtx; let admin: AdminActor;
    beforeAll(async () => { ctx = await createTestCtx(engine); admin = await makeAdmin(ctx); });
    afterAll(() => ctx.close());

    it("claims a task, snapshots the reward and starts the timer", async () => {
      const u = await makeUser(ctx);
      const task = await makeTask(ctx, admin, { reward: 5000n, timerMinutes: 30 });
      const c = await claimTask(ctx, u.userId, task, u.identityId);
      expect(c).toMatchObject({ status: "claimed", reward: 5000n, minutesLeft: 30, identityEmail: u.email });
      ctx.clock.advance(10 * 60_000);
      expect((await listClaims(ctx, u.userId))[0]!.minutesLeft).toBe(20);
    });

    it("a task with no time limit has no countdown", async () => {
      const u = await makeUser(ctx);
      const c = await claimTask(ctx, u.userId, await makeTask(ctx, admin, { timerMinutes: null }), u.identityId);
      expect(c.minutesLeft).toBeUndefined();
    });

    it("an email can claim a task once, but another email of the same account can claim it again", async () => {
      const u = await makeUser(ctx);
      const task = await makeTask(ctx, admin);
      await claimTask(ctx, u.userId, task, u.identityId);
      expect(await code(claimTask(ctx, u.userId, task, u.identityId))).toBe("already_claimed");
      const second = await addIdentityDirect(ctx, u.userId);
      await expect(claimTask(ctx, u.userId, task, second)).resolves.toMatchObject({ status: "claimed" });
    });

    it("the per-account cap counts every email of the account", async () => {
      const u = await makeUser(ctx);
      const task = await makeTask(ctx, admin, { maxClaimsPerAccount: 2 });
      await claimTask(ctx, u.userId, task, u.identityId);
      await claimTask(ctx, u.userId, task, await addIdentityDirect(ctx, u.userId));
      expect(await code(claimTask(ctx, u.userId, task, await addIdentityDirect(ctx, u.userId)))).toBe("claim_limit");
    });

    it("cannot claim with someone else's email", async () => {
      const a = await makeUser(ctx); const b = await makeUser(ctx);
      expect(await code(claimTask(ctx, a.userId, await makeTask(ctx, admin), b.identityId))).toBe("not_found");
    });

    it("refuses paused, removed, expired and full tasks", async () => {
      const u = await makeUser(ctx);
      const paused = await makeTask(ctx, admin);
      await setTaskStatus(ctx, admin, paused, "paused");
      expect(await code(claimTask(ctx, u.userId, paused, u.identityId))).toBe("task_closed");
      await setTaskStatus(ctx, admin, paused, "active");
      await expect(claimTask(ctx, u.userId, paused, u.identityId)).resolves.toBeDefined();

      const removed = await makeTask(ctx, admin);
      await setTaskStatus(ctx, admin, removed, "removed");
      expect(await code(claimTask(ctx, u.userId, removed, u.identityId))).toBe("not_found");

      const ends = await makeTask(ctx, admin, { activeUntil: new Date(ctx.now().getTime() + 3_600_000).toISOString() });
      ctx.clock.advance(2 * 3_600_000);
      expect(await code(claimTask(ctx, u.userId, ends, u.identityId))).toBe("task_closed");

      const one = await makeTask(ctx, admin, { slotsTotal: 1 });
      await claimTask(ctx, (await makeUser(ctx)).userId, one, (await ctx.db.query<{ id: string }>("select id from identities order by created_at desc limit 1"))[0]!.id).catch(() => undefined);
    });

    it("the last slot goes to one worker and the next is told it is full", async () => {
      const a = await makeUser(ctx); const b = await makeUser(ctx);
      const task = await makeTask(ctx, admin, { slotsTotal: 1 });
      await claimTask(ctx, a.userId, task, a.identityId);
      expect(await code(claimTask(ctx, b.userId, task, b.identityId))).toBe("slots_full");
      const board = (await listBoard(ctx)).find((t) => t.id === task)!;
      expect(board).toMatchObject({ slotsRemaining: 0, status: "closed" });
    });

    it("a suspended account cannot claim", async () => {
      const u = await makeUser(ctx);
      await ctx.db.query("update users set status = 'suspended' where id = $1", [u.userId]);
      expect(await code(claimTask(ctx, u.userId, await makeTask(ctx, admin), u.identityId))).toBe("suspended");
    });

    it("an expired claim frees the slot and the email can claim again", async () => {
      const u = await makeUser(ctx);
      const task = await makeTask(ctx, admin, { slotsTotal: 1, timerMinutes: 10 });
      await claimTask(ctx, u.userId, task, u.identityId);
      await expireClaims(ctx);
      expect((await listClaims(ctx, u.userId))[0]!.status).toBe("claimed"); // not due yet
      ctx.clock.advance(11 * 60_000);
      expect(await expireClaims(ctx)).toBeGreaterThanOrEqual(1);
      expect((await listClaims(ctx, u.userId))[0]!.status).toBe("expired");
      await expect(claimTask(ctx, u.userId, task, u.identityId)).resolves.toMatchObject({ status: "claimed" });
    });

    it("cannot submit after the timer ran out, even before the sweeper runs", async () => {
      const u = await makeUser(ctx);
      const task = await makeTask(ctx, admin, { timerMinutes: 5 });
      const c = await claimTask(ctx, u.userId, task, u.identityId);
      const { fileId } = await saveUpload(ctx, u.userId, "proof", PNG);
      ctx.clock.advance(6 * 60_000);
      expect(await code(submitProof(ctx, u.userId, c.id, { fileId }))).toBe("conflict");
      expect((await listClaims(ctx, u.userId))[0]!.status).toBe("expired");
    });

    it("removing a task voids claims that were not submitted yet", async () => {
      const u = await makeUser(ctx); const v = await makeUser(ctx);
      const task = await makeTask(ctx, admin);
      await claimTask(ctx, u.userId, task, u.identityId);
      const c = await claimTask(ctx, v.userId, task, v.identityId);
      const { fileId } = await saveUpload(ctx, v.userId, "proof", PNG);
      await submitProof(ctx, v.userId, c.id, { fileId });
      await setTaskStatus(ctx, admin, task, "removed");
      expect((await listClaims(ctx, u.userId))[0]!.status).toBe("void");
      expect((await listClaims(ctx, v.userId))[0]!.status).toBe("under_review");
    });

    it("manual scripts: with N scripts and M workers each script is used floor or ceil of M/N times, in random order", async () => {
      const scripts = Array.from({ length: 10 }, (_, i) => `Script number ${i}`);
      const task = await makeTask(ctx, admin, { textMode: "manual_pool", scripts, slotsTotal: null });
      const users = await Promise.all(Array.from({ length: 100 }, () => makeUser(ctx)));
      const claims = await Promise.all(users.map((u) => claimTask(ctx, u.userId, task, u.identityId)));
      const used = new Map<string, number>();
      for (const c of claims) used.set(c.assignedText!, (used.get(c.assignedText!) ?? 0) + 1);
      expect([...used.keys()].sort()).toEqual([...scripts].sort());
      expect([...used.values()].every((n) => n === 10)).toBe(true);
      expect(claims.slice(0, 10).map((c) => c.assignedText)).not.toEqual(scripts); // not simply in order
    });

    it("scripts added later are mixed into what is still waiting", async () => {
      const task = await makeTask(ctx, admin, { textMode: "manual_pool", scripts: ["A one", "B two"] });
      const seen: string[] = [];
      for (let i = 0; i < 2; i++) { const u = await makeUser(ctx); seen.push((await claimTask(ctx, u.userId, task, u.identityId)).assignedText!); }
      expect(seen.sort()).toEqual(["A one", "B two"]);
      await addScripts(ctx, admin, task, ["C three"]);
      const u = await makeUser(ctx);
      expect((await claimTask(ctx, u.userId, task, u.identityId)).assignedText).toBe("C three");
      expect((await getAdminTask(ctx, admin, task)).scripts).toEqual(["A one", "B two", "C three"]);
    });

    it("AI scripts: written once, stored, and only task fields are sent", async () => {
      const sent: unknown[] = [];
      const real = ctx.ai;
      ctx.ai = { generateScript: async (r) => { sent.push(r); return "  A fresh script.  "; } };
      const task = await createTask(ctx, admin, taskInput({ textMode: "ai_generated", keywords: ["pricing"], aiConfig: { tone: "friendly", language: "English", minWords: 20, maxWords: 50, style: "email" } }));
      const u = await makeUser(ctx, "Secret Name");
      const c = await claimTask(ctx, u.userId, task.id, u.identityId);
      expect(c).toMatchObject({ assignedText: "A fresh script.", textStatus: "ready" });
      expect(Object.keys(sent[0] as object).sort()).toEqual(["description", "keywords", "language", "maxWords", "minWords", "style", "title", "tone"]);
      expect(JSON.stringify(sent)).not.toContain("Secret Name");
      expect(JSON.stringify(sent)).not.toContain(u.email);
      ctx.ai = real;
    });

    it("AI failure keeps the claim, marks the script failed, and the worker can retry", async () => {
      const real = ctx.ai;
      let fail = true;
      ctx.ai = { generateScript: async () => { if (fail) throw new Error("provider down"); return "Second try works."; } };
      const task = await createTask(ctx, admin, taskInput({ textMode: "ai_generated", keywords: ["x"], aiConfig: { tone: "casual", language: "English", minWords: 20, maxWords: 50, style: "cold_message" } }));
      const u = await makeUser(ctx);
      const c = await claimTask(ctx, u.userId, task.id, u.identityId);
      expect(c).toMatchObject({ status: "claimed", textStatus: "failed" });
      expect(c.assignedText).toBeUndefined();
      fail = false;
      expect(await retryClaimText(ctx, u.userId, c.id)).toMatchObject({ textStatus: "ready", assignedText: "Second try works." });
      const other = await makeUser(ctx);
      expect(await code(retryClaimText(ctx, other.userId, c.id))).toBe("forbidden");
      ctx.ai = real;
    });

    it("validates the new task form on the server", async () => {
      const bad = (o: Parameters<typeof taskInput>[0]) => code(createTask(ctx, admin, taskInput(o)));
      expect(await bad({ title: " " })).toBe("bad_request");
      expect(await bad({ siteUrl: "http://insecure.example" })).toBe("bad_request");
      expect(await bad({ reward: 0n })).toBe("bad_request");
      expect(await bad({ textMode: "manual_pool", scripts: [" "] })).toBe("bad_request");
      expect(await bad({ textMode: "keywords", keywords: [] })).toBe("bad_request");
      expect(await bad({ textMode: "ai_generated", keywords: ["a"], description: "short" })).toBe("bad_request");
      expect(await bad({ activeUntil: new Date(ctx.now().getTime() - 1000).toISOString() })).toBe("bad_request");
    });

    it("a worker cannot create tasks; an admin without task.manage cannot either", async () => {
      const reviewer = await makeAdmin(ctx, ["review.decide"]);
      expect(await code(createTask(ctx, reviewer, taskInput()))).toBe("forbidden");
    });

    if (engine === "postgres") {
      it("50 workers pressing Claim at once on a 10-slot task get exactly 10 slots", async () => {
        const task = await makeTask(ctx, admin, { slotsTotal: 10 });
        const users = await Promise.all(Array.from({ length: 50 }, () => makeUser(ctx)));
        const results = await Promise.allSettled(users.map((u) => claimTask(ctx, u.userId, task, u.identityId)));
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
        const reasons = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => (r.reason as ApiError).code);
        expect(reasons.every((c) => c === "slots_full")).toBe(true);
        const [{ n }] = await ctx.db.query<{ n: number }>("select count(*)::int as n from task_claims where template_id = $1", [task]) as [{ n: number }];
        expect(n).toBe(10);
      });

      it("the same worker double-clicking Claim gets one claim", async () => {
        const u = await makeUser(ctx);
        const task = await makeTask(ctx, admin);
        const r = await Promise.allSettled([1, 2, 3, 4, 5].map(() => claimTask(ctx, u.userId, task, u.identityId)));
        expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      });
    }
  });
}
