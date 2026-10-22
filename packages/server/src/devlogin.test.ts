import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS } from "@rr/core";
import { balanceOf, createBuiltinAuth, loadAdmin, resolveSession, reviewQueue } from "./index";
import { devLogin, DEV_ACCOUNTS, DEV_PASSWORD } from "./devlogin";
import { createTestCtx, engines, type TestCtx } from "./testing";

for (const engine of engines()) {
  describe(`development quick login on ${engine}`, () => {
    let ctx: TestCtx;
    beforeAll(async () => { ctx = await createTestCtx(engine); });
    afterAll(() => ctx.close());

    const tokenOf = (cookie: string) => decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!);

    it("signs in as the demo admin (every permission, work waiting) and as the demo worker (money to withdraw)", async () => {
      const a = await devLogin(ctx, "admin");
      expect(a.location).toBe("/admin");
      const adminSession = (await resolveSession(ctx, tokenOf(a.cookie)))!;
      const admin = (await loadAdmin(ctx.db, adminSession.userId))!;
      expect(admin.permissions.size).toBe(PERMISSIONS.length);
      expect(await reviewQueue(ctx, admin)).toHaveLength(1);

      const w = await devLogin(ctx, "worker");
      expect(w.location).toBe("/app");
      const worker = (await resolveSession(ctx, tokenOf(w.cookie)))!;
      expect((await balanceOf(ctx.db, worker.userId)).available).toBe(4000n);
    });

    it("demo data is created once, however often it is used", async () => {
      await devLogin(ctx, "admin"); await devLogin(ctx, "worker"); await devLogin(ctx, "admin");
      const [t] = await ctx.db.query<{ n: number }>("select count(*)::int as n from task_templates where title like 'Demo:%'");
      expect(t!.n).toBe(3);
    });

    it("the demo accounts also work through the normal login screen", async () => {
      await devLogin(ctx, "worker");
      await expect(createBuiltinAuth(ctx).signIn(DEV_ACCOUNTS.worker.email, DEV_PASSWORD)).resolves.toBeDefined();
    });
  });
}
