import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS } from "@rr/core";
import { OWNER_ROLE_ID } from "@rr/db";
import { createBuiltinAuth, loadAdmin, seedOwner } from "./index";
import { createTestCtx, engines, type TestCtx } from "./testing";

for (const engine of engines()) {
  describe(`owner seed on ${engine}`, () => {
    let ctx: TestCtx;
    beforeAll(async () => { ctx = await createTestCtx(engine); });
    afterAll(() => ctx.close());

    it("creates the owner once, with every permission, who can then sign in; running again changes nothing", async () => {
      const o = { email: "Boss@Example.com", name: "The Boss", password: "owner password 1" };
      expect(await seedOwner(ctx, o)).toBe("created");
      expect(await seedOwner(ctx, { ...o, password: "a different one" })).toBe("existing");
      const { userId } = await createBuiltinAuth(ctx).signIn("boss@example.com", "owner password 1");
      const admin = (await loadAdmin(ctx.db, userId))!;
      expect(admin).toMatchObject({ isOwner: true, name: "The Boss", roleIds: [OWNER_ROLE_ID] });
      expect(admin.permissions.size).toBe(PERMISSIONS.length);
      const [c] = await ctx.db.query<{ n: number }>("select count(*)::int as n from admin_members where is_owner");
      expect(c!.n).toBe(1);
    });
    it("refuses a bad email", async () => {
      await expect(seedOwner(ctx, { email: "nope", name: "x", password: "longenough1" })).rejects.toMatchObject({ code: "invalid_email" });
    });
  });
}
