import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@rr/core";
import { OUTCOME_PERCENTS, rupees } from "@rr/money";
import {
  balanceOf, claimTask, decide, getPayout, listClaims, listPayouts, markPaid, reconcile, requestPayout, reviewQueue, saveUpload, walletView
} from "./index";
import { PNG, createTestCtx, engines, fund, makeAdmin, makeTask, makeUser, submitted, type TestCtx } from "./testing";
import type { AdminActor } from "./rbac";

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as ApiError | null)?.code;

for (const engine of engines()) {
  describe(`reviews and money on ${engine}`, () => {
    let ctx: TestCtx; let owner: AdminActor; let reviewer: AdminActor; let payer: AdminActor;
    beforeAll(async () => {
      ctx = await createTestCtx(engine);
      owner = await makeAdmin(ctx);
      reviewer = await makeAdmin(ctx, ["review.decide"]);
      payer = await makeAdmin(ctx, ["payout.mark_paid"]);
    });
    afterAll(() => ctx.close());

    const balance = async (userId: string) => (await balanceOf(ctx.db, userId)).available;

    it("every outcome credits floor(reward x pct / 100), nothing more", async () => {
      for (const pct of OUTCOME_PERCENTS) {
        const u = await makeUser(ctx);
        const task = await makeTask(ctx, owner, { reward: 3333n });
        const { submissionId } = await submitted(ctx, u, task);
        await decide(ctx, reviewer, submissionId, pct, "ok");
        expect(await balance(u.userId)).toBe((3333n * BigInt(pct)) / 100n);
      }
    });

    it("sets the claim status from the outcome and shows the reviewer's note to the worker", async () => {
      const results: [number, string][] = [[100, "approved"], [50, "partial"], [0, "rejected"]];
      for (const [pct, status] of results) {
        const u = await makeUser(ctx);
        const { submissionId } = await submitted(ctx, u, await makeTask(ctx, owner));
        await decide(ctx, reviewer, submissionId, pct as 100, `note ${pct}`);
        expect((await listClaims(ctx, u.userId))[0]).toMatchObject({ status, outcome: pct, reviewerNote: `note ${pct}` });
      }
    });

    it("a note is required, and only reviewers may decide", async () => {
      const u = await makeUser(ctx);
      const { submissionId } = await submitted(ctx, u, await makeTask(ctx, owner));
      expect(await code(decide(ctx, reviewer, submissionId, 100, "   "))).toBe("bad_request");
      expect(await code(decide(ctx, payer, submissionId, 100, "ok"))).toBe("forbidden");
      expect(await balance(u.userId)).toBe(0n);
    });

    it("nobody can review their own work, even an admin who also works tasks", async () => {
      const worker = await makeAdmin(ctx, ["review.decide"]);
      const [ident] = await ctx.db.query<{ id: string }>("select id from identities where user_id = $1", [worker.userId]);
      const task = await makeTask(ctx, owner, { reward: 5000n });
      const { submissionId } = await submitted(ctx, { userId: worker.userId, identityId: ident!.id, email: "x", name: "x" }, task);
      expect(await code(decide(ctx, worker, submissionId, 100, "I did great"))).toBe("forbidden");
      expect(await balance(worker.userId)).toBe(0n);
      await expect(decide(ctx, reviewer, submissionId, 100, "A colleague agrees")).resolves.toBeUndefined();
      expect(await balance(worker.userId)).toBe(5000n);
    });

    it("a submission can be decided once", async () => {
      const u = await makeUser(ctx);
      const { submissionId } = await submitted(ctx, u, await makeTask(ctx, owner, { reward: 1000n }));
      await decide(ctx, reviewer, submissionId, 100, "ok");
      expect(await code(decide(ctx, reviewer, submissionId, 100, "again"))).toBe("not_pending");
      expect(await balance(u.userId)).toBe(1000n);
    });

    it("the queue lists pending work with the keyword check, oldest first, and drops it once decided", async () => {
      const u = await makeUser(ctx, "Queue Worker");
      const task = await makeTask(ctx, owner, { textMode: "keywords", keywords: ["pricing", "free trial", "onboarding"] });
      const { submissionId } = await submitted(ctx, u, task, "I explained the Pricing and the free trial today.");
      const item = (await reviewQueue(ctx, reviewer)).find((q) => q.id === submissionId)!;
      expect(item).toMatchObject({ worker: "Queue Worker", keywords: ["pricing", "free trial", "onboarding"], keywordsMatched: ["pricing", "free trial"] });
      expect(item.proofUrl).toMatch(/^\/api\/files\//);
      expect(item.identityEmail).toContain("••@");
      await decide(ctx, reviewer, submissionId, 75, "ok");
      expect((await reviewQueue(ctx, reviewer)).some((q) => q.id === submissionId)).toBe(false);
    });

    it("the reward is fixed at claim time", async () => {
      const u = await makeUser(ctx);
      const task = await makeTask(ctx, owner, { reward: 4000n });
      const claim = await claimTask(ctx, u.userId, task, u.identityId);
      await ctx.db.query("update task_templates set reward_paise = 99999 where id = $1", [task]);
      const { fileId } = await saveUpload(ctx, u.userId, "proof", PNG);
      const { submitProof } = await import("./submissions");
      await submitProof(ctx, u.userId, claim.id, { fileId });
      const [s] = await ctx.db.query<{ id: string }>("select id from submissions where claim_id = $1", [claim.id]);
      await decide(ctx, reviewer, s!.id, 100, "ok");
      expect(await balance(u.userId)).toBe(4000n);
    });

    it("wallet: totals, per-email earnings and entries come from the ledger", async () => {
      const u = await makeUser(ctx);
      await fund(ctx, u, reviewer, owner, 60n);
      const w = await walletView(ctx, u.userId);
      expect(w.earned).toBe(rupees(60));
      expect(w.entries).toHaveLength(1);
      expect(w.identities.find((i) => i.isPrimary)!.earned).toBe(rupees(60));
    });

    describe("payouts", () => {
      const proof = async (a: AdminActor) => (await saveUpload(ctx, a.userId, "payment_proof", PNG)).fileId;

      it("requests are held from the balance at once and validated", async () => {
        const u = await makeUser(ctx);
        await fund(ctx, u, reviewer, owner, 100n);
        expect(await code(requestPayout(ctx, u.userId, 500n, "me@okbank"))).toBe("below_minimum");
        expect(await code(requestPayout(ctx, u.userId, rupees(50), "not-a-upi"))).toBe("bad_request");
        expect(await code(requestPayout(ctx, u.userId, rupees(150), "me@okbank"))).toBe("insufficient_balance");
        const p = await requestPayout(ctx, u.userId, rupees(40), "priya@okhdfc");
        expect(p).toMatchObject({ status: "pending", amount: rupees(40), upiMasked: "pri••@okhdfc" });
        expect(p.upiFull).toBeUndefined();
        expect(await balance(u.userId)).toBe(rupees(60));
        expect(await code(requestPayout(ctx, u.userId, rupees(10), "priya@okhdfc"))).toBe("payout_pending");
      });

      it("the UPI ID is encrypted at rest and only the payer screen can read it (and that read is logged)", async () => {
        const u = await makeUser(ctx);
        await fund(ctx, u, reviewer, owner, 100n);
        const p = await requestPayout(ctx, u.userId, rupees(20), "secret.name@okaxis");
        const [row] = await ctx.db.query<{ upi_encrypted: string }>("select upi_encrypted from payout_requests where id = $1", [p.id]);
        expect(row!.upi_encrypted).not.toContain("secret");
        expect((await listPayouts(ctx, payer)).find((x) => x.id === p.id)!.upiFull).toBeUndefined();
        expect((await getPayout(ctx, payer, p.id)).upiFull).toBe("secret.name@okaxis");
        const [log] = await ctx.db.query<{ n: number }>("select count(*)::int as n from admin_audit_log where action = 'payout.view_upi' and target_id = $1", [p.id]);
        expect(log!.n).toBe(1);
        expect(await code(getPayout(ctx, reviewer, p.id))).toBe("forbidden");
      });

      it("marking paid needs the screenshot, records who paid, moves the money and cannot be repeated", async () => {
        const u = await makeUser(ctx);
        await fund(ctx, u, reviewer, owner, 100n);
        const p = await requestPayout(ctx, u.userId, rupees(70), "me@okbank");
        expect(await code(markPaid(ctx, payer, p.id, "00000000-0000-0000-0000-000000000000"))).toBe("upload_invalid");
        await markPaid(ctx, payer, p.id, await proof(payer));
        const w = await walletView(ctx, u.userId);
        expect(w.payouts[0]).toMatchObject({ status: "paid", paidBy: expect.any(String) });
        expect(await balance(u.userId)).toBe(rupees(30));
        const b = await balanceOf(ctx.db, u.userId);
        expect(b).toMatchObject({ credits: rupees(100), debits: rupees(70), pending: 0n });
        expect(await code(markPaid(ctx, payer, p.id, await proof(payer)))).toBe("not_pending");
        // and they can ask again now
        await expect(requestPayout(ctx, u.userId, rupees(30), "me@okbank")).resolves.toMatchObject({ status: "pending" });
      });

      it("proof must be the payer's own payment screenshot, used once", async () => {
        const a = await makeUser(ctx); const b = await makeUser(ctx);
        await fund(ctx, a, reviewer, owner, 50n); await fund(ctx, b, reviewer, owner, 50n);
        const pa = await requestPayout(ctx, a.userId, rupees(20), "aa@okbank");
        const pb = await requestPayout(ctx, b.userId, rupees(20), "bb@okbank");
        const wrongKind = (await saveUpload(ctx, payer.userId, "proof", PNG)).fileId;
        expect(await code(markPaid(ctx, payer, pa.id, wrongKind))).toBe("upload_invalid");
        const other = await makeAdmin(ctx, ["payout.mark_paid"]);
        expect(await code(markPaid(ctx, payer, pa.id, await proof(other)))).toBe("upload_invalid");
        const good = await proof(payer);
        await markPaid(ctx, payer, pa.id, good);
        expect(await code(markPaid(ctx, payer, pb.id, good))).toBe("upload_invalid");
      });

      it("only a payer can see or pay requests", async () => {
        const u = await makeUser(ctx);
        await fund(ctx, u, reviewer, owner, 50n);
        const p = await requestPayout(ctx, u.userId, rupees(20), "aa@okbank");
        expect(await code(listPayouts(ctx, reviewer))).toBe("forbidden");
        expect(await code(markPaid(ctx, reviewer, p.id, await proof(payer)))).toBe("forbidden");
      });

      it("a suspended worker cannot request a payout but the admin can still pay what was requested", async () => {
        const u = await makeUser(ctx);
        await fund(ctx, u, reviewer, owner, 50n);
        const p = await requestPayout(ctx, u.userId, rupees(20), "aa@okbank");
        await ctx.db.query("update users set status = 'suspended' where id = $1", [u.userId]);
        expect(await code(requestPayout(ctx, u.userId, rupees(10), "aa@okbank"))).toBe("suspended");
        await expect(markPaid(ctx, payer, p.id, await proof(payer))).resolves.toBeUndefined();
      });

      it("the ledger cannot be changed, even by buggy application code", async () => {
        const u = await makeUser(ctx);
        await fund(ctx, u, reviewer, owner, 50n);
        await expect(ctx.db.query("update wallet_transactions set amount_paise = amount_paise + 1 where user_id = $1", [u.userId])).rejects.toThrow(/append-only/);
        await expect(ctx.db.query("delete from reviews")).rejects.toThrow(/append-only/);
      });
    });

    describe("reconciliation", () => {
      it("is clean after a normal run, and finds tampering that the triggers cannot see", async () => {
        const u = await makeUser(ctx);
        await fund(ctx, u, reviewer, owner, 100n);
        const p = await requestPayout(ctx, u.userId, rupees(40), "aa@okbank");
        await markPaid(ctx, payer, p.id, (await saveUpload(ctx, payer.userId, "payment_proof", PNG)).fileId);
        expect((await reconcile(ctx)).problems).toEqual([]);

        // A claim row edited behind the application's back (status says rejected, but a credit exists) is the kind of thing it reports.
        const [c] = await ctx.db.query<{ id: string }>("select id from task_claims where user_id = $1", [u.userId]);
        await ctx.db.query("update task_claims set status = 'under_review' where id = $1", [c!.id]);
        const report = await reconcile(ctx);
        expect(report.ok).toBe(false);
        expect(report.problems.join("\n")).toContain("claim status and submission status disagree");
        await ctx.db.query("update task_claims set status = 'approved' where id = $1", [c!.id]);
      });

      it("detects a task over-claimed past its slots", async () => {
        const task = await makeTask(ctx, owner, { slotsTotal: 1 });
        await Promise.all([1, 2].map(async () => { const u = await makeUser(ctx); await ctx.db.query("insert into task_claims (workspace_id, template_id, user_id, identity_id, reward_paise) values ($1,$2,$3,$4,100)", [ctx.cfg.workspaceId, task, u.userId, u.identityId]); }));
        expect((await reconcile(ctx)).problems.join("\n")).toContain("more live claims than slots");
        await ctx.db.query("update task_claims set status = 'void' where template_id = $1", [task]);
        expect((await reconcile(ctx)).problems).toEqual([]);
      });
    });

    if (engine === "postgres") {
      describe("concurrency (real Postgres)", () => {
        it("two reviewers deciding the same submission at once: one wins, the money is credited once", async () => {
          const u = await makeUser(ctx);
          const { submissionId } = await submitted(ctx, u, await makeTask(ctx, owner, { reward: 5000n }));
          const r2 = await makeAdmin(ctx, ["review.decide"]);
          const out = await Promise.allSettled([decide(ctx, reviewer, submissionId, 100, "a"), decide(ctx, r2, submissionId, 100, "b")]);
          expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
          expect(await balance(u.userId)).toBe(5000n);
        });

        it("ten payout requests at once for the same worker: exactly one is created", async () => {
          const u = await makeUser(ctx);
          await fund(ctx, u, reviewer, owner, 100n);
          const out = await Promise.allSettled(Array.from({ length: 10 }, () => requestPayout(ctx, u.userId, rupees(60), "aa@okbank")));
          expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
          expect((await balanceOf(ctx.db, u.userId)).pending).toBe(rupees(60));
        });

        it("two payers paying the same request at once: it is paid once, one debit", async () => {
          const u = await makeUser(ctx);
          await fund(ctx, u, reviewer, owner, 100n);
          const p = await requestPayout(ctx, u.userId, rupees(80), "aa@okbank");
          const p2 = await makeAdmin(ctx, ["payout.mark_paid"]);
          const out = await Promise.allSettled([
            markPaid(ctx, payer, p.id, (await saveUpload(ctx, payer.userId, "payment_proof", PNG)).fileId),
            markPaid(ctx, p2, p.id, (await saveUpload(ctx, p2.userId, "payment_proof", PNG)).fileId)
          ]);
          expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
          const [d] = await ctx.db.query<{ n: number }>("select count(*)::int as n from wallet_transactions where payout_request_id = $1", [p.id]);
          expect(d!.n).toBe(1);
          expect((await reconcile(ctx)).problems).toEqual([]);
        });
      });
    }
  });
}
