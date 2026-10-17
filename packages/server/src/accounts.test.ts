import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@rr/core";
import {
  addIdentity, createBuiltinAuth, createSession, csrfToken, decryptUpi, encryptUpi, hashPassword, getMe, purgeExpired, resolveSession,
  revokeSession, sendIdentityCode, verifyPassword, type AuthProvider
} from "./index";
import { createTestCtx, engines, makeUser, type TestCtx } from "./testing";

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as ApiError | null;
const code = async (p: Promise<unknown>) => (await err(p))?.code;

for (const engine of engines()) {
  describe(`accounts on ${engine}`, () => {
    let ctx: TestCtx; let auth: AuthProvider;
    beforeAll(async () => { ctx = await createTestCtx(engine); auth = createBuiltinAuth(ctx); });
    afterAll(() => ctx.close());

    let n = 0;
    const email = () => `person${Date.now().toString(36)}${n++}@example.com`;
    const lastCode = () => ctx.outbox.sent[ctx.outbox.sent.length - 1]!.code;
    const wait = () => ctx.clock.advance(31_000);

    async function signUp(e = email(), password = "correct horse 1") {
      await auth.requestCode(e, "signup", { name: "Asha Rao", phone: "98765 43210" });
      const { ticket } = await auth.verifyCode(e, lastCode(), "signup");
      const { userId } = await auth.completeSignup(ticket, password);
      return { email: e, userId, password };
    }

    it("sign-up: email, code, password creates the account with its main email and profile", async () => {
      const a = await signUp();
      const me = await getMe(ctx, a.userId);
      expect(me).toMatchObject({ name: "Asha Rao", phone: "9876543210", email: a.email, isAdmin: false });
      expect(me.identities).toHaveLength(1);
      expect(me.identities[0]).toMatchObject({ isPrimary: true });
      expect(ctx.outbox.sent.at(-1)).toMatchObject({ kind: "signup_code", to: a.email, expiresInMinutes: 10 });
      expect((await auth.signIn(a.email.toUpperCase(), a.password)).userId).toBe(a.userId);
    });

    it("passwords are stored hashed, never plain", async () => {
      const a = await signUp();
      const [c] = await ctx.db.query<{ password_hash: string }>("select password_hash from auth_credentials where user_id = $1", [a.userId]);
      expect(c!.password_hash.startsWith("scrypt$")).toBe(true);
      expect(c!.password_hash).not.toContain(a.password);
      expect(await verifyPassword("wrong", c!.password_hash)).toBe(false);
    });

    it("validates the sign-up details and refuses an email that already has an account", async () => {
      expect(await code(auth.requestCode("nope", "signup", { name: "A" }))).toBe("invalid_email");
      expect(await code(auth.requestCode(email(), "signup", { name: " " }))).toBe("bad_request");
      expect(await code(auth.requestCode(email(), "signup", { name: "A", phone: "abc" }))).toBe("bad_request");
      const a = await signUp();
      wait();
      expect(await code(auth.requestCode(a.email, "signup", { name: "Again" }))).toBe("email_taken");
    });

    it("a short password does not burn the step, and a step works once", async () => {
      const e = email();
      await auth.requestCode(e, "signup", { name: "A B" });
      const { ticket } = await auth.verifyCode(e, lastCode(), "signup");
      expect(await code(auth.completeSignup(ticket, "short"))).toBe("weak_password");
      expect((await auth.completeSignup(ticket, "longenough1")).userId).toBeDefined();
      expect(await code(auth.completeSignup(ticket, "longenough1"))).toBe("invalid_code");
    });

    it("a reset step cannot be used to sign up, nor a sign-up step to reset", async () => {
      const a = await signUp();
      wait();
      await auth.requestCode(a.email, "reset");
      const { ticket } = await auth.verifyCode(a.email, lastCode(), "reset");
      expect(await code(auth.completeSignup(ticket, "longenough1"))).toBe("invalid_code");
      await auth.completeReset(ticket, "longenough1");
    });

    describe("one-time codes", () => {
      it("five wrong guesses lock the code for good, even though each guess failed with an error", async () => {
        const e = email();
        await auth.requestCode(e, "signup", { name: "A B" });
        const real = lastCode(); const wrong = real === "000000" ? "111111" : "000000";
        for (let i = 0; i < 4; i++) expect(await code(auth.verifyCode(e, wrong, "signup"))).toBe("invalid_code");
        expect(await code(auth.verifyCode(e, wrong, "signup"))).toBe("too_many_attempts");
        expect(await code(auth.verifyCode(e, real, "signup"))).toBe("too_many_attempts");
        wait();
        await auth.requestCode(e, "signup", { name: "A B" });
        await expect(auth.verifyCode(e, lastCode(), "signup")).resolves.toHaveProperty("ticket");
      });
      it("expires after ten minutes", async () => {
        const e = email();
        await auth.requestCode(e, "signup", { name: "A B" });
        ctx.clock.advance(10 * 60_000);
        expect(await code(auth.verifyCode(e, lastCode(), "signup"))).toBe("code_expired");
      });
      it("a 30 second resend cooldown and five codes an hour", async () => {
        const e = email();
        await auth.requestCode(e, "signup", { name: "A B" });
        const again = await err(auth.requestCode(e, "signup", { name: "A B" }));
        expect(again).toMatchObject({ code: "rate_limited", status: 429 });
        expect(again!.retryAfterSeconds).toBeGreaterThan(0);
        for (let i = 0; i < 4; i++) { wait(); await auth.requestCode(e, "signup", { name: "A B" }); }
        wait();
        expect(await code(auth.requestCode(e, "signup", { name: "A B" }))).toBe("rate_limited");
      });
      it("only a hash of the code is stored", async () => {
        const e = email();
        await auth.requestCode(e, "signup", { name: "A B" });
        const [row] = await ctx.db.query<{ code_hash: string }>("select code_hash from auth_codes where key = $1", [`signup:${e}`]);
        expect(row!.code_hash).not.toContain(lastCode());
        expect(row!.code_hash).toHaveLength(64);
      });
    });

    describe("forgot and reset password", () => {
      it("resets the password, signs out every session, and the old password stops working", async () => {
        const a = await signUp();
        const s = await createSession(ctx, a.userId);
        wait();
        await auth.requestCode(a.email, "reset");
        expect(ctx.outbox.sent.at(-1)).toMatchObject({ kind: "reset_code", to: a.email });
        const { ticket } = await auth.verifyCode(a.email, lastCode(), "reset");
        await auth.completeReset(ticket, "brand new pass 9");
        expect(await resolveSession(ctx, s.token)).toBeNull();
        expect(await code(auth.signIn(a.email, a.password))).toBe("invalid_credentials");
        expect((await auth.signIn(a.email, "brand new pass 9")).userId).toBe(a.userId);
      });
      it("looks identical for an unknown email and sends nothing", async () => {
        const before = ctx.outbox.sent.length;
        const sent = await auth.requestCode("ghost@example.com", "reset");
        expect(sent).toMatchObject({ resendAfterSeconds: 30, expiresInSeconds: 600 });
        expect(ctx.outbox.sent).toHaveLength(before);
        expect(await code(auth.verifyCode("ghost@example.com", "123456", "reset"))).toBe("invalid_code");
      });
      it("an extra email cannot reset the account: only the main login email can", async () => {
        const a = await signUp();
        const other = email();
        const sentCode = async () => { await sendIdentityCode(ctx, a.userId, other); return lastCode(); };
        await addIdentity(ctx, a.userId, other, await sentCode());
        const before = ctx.outbox.sent.length;
        await auth.requestCode(other, "reset");
        expect(ctx.outbox.sent).toHaveLength(before);
      });
    });

    describe("signing in", () => {
      it("gives one generic error for a wrong password and for an unknown email", async () => {
        const a = await signUp();
        const wrongPw = await err(auth.signIn(a.email, "wrongwrongwrong"));
        const unknown = await err(auth.signIn(email(), "wrongwrongwrong"));
        expect(wrongPw).toMatchObject({ code: "invalid_credentials", status: 401, message: unknown!.message });
      });
      it("locks an email for 15 minutes after five failures, and a good login clears the count", async () => {
        const a = await signUp();
        for (let i = 0; i < 4; i++) await code(auth.signIn(a.email, "wrongwrongwrong"));
        await auth.signIn(a.email, a.password);
        for (let i = 0; i < 5; i++) expect(await code(auth.signIn(a.email, "wrongwrongwrong"))).toBe("invalid_credentials");
        expect(await code(auth.signIn(a.email, a.password))).toBe("rate_limited");
        ctx.clock.advance(15 * 60_000);
        await expect(auth.signIn(a.email, a.password)).resolves.toBeDefined();
      });
      it("thirty guesses fired at once get five tries, not thirty", async () => {
        const a = await signUp();
        const out = await Promise.all(Array.from({ length: 30 }, (_, i) => code(auth.signIn(a.email, `wrong-guess-${i}`))));
        expect(out.filter((c) => c === "invalid_credentials")).toHaveLength(5);
        expect(out.filter((c) => c === "rate_limited")).toHaveLength(25);
      });
      it("a suspended account cannot sign in, and a deleted one has no credentials", async () => {
        const a = await signUp();
        await ctx.db.query("update users set status = 'suspended' where id = $1", [a.userId]);
        expect(await code(auth.signIn(a.email, a.password))).toBe("suspended");
        await ctx.db.query("delete from auth_credentials where user_id = $1", [a.userId]);
        expect(await code(auth.signIn(a.email, a.password))).toBe("invalid_credentials");
      });
      it("only the main email signs in", async () => {
        const a = await signUp();
        const other = email();
        await sendIdentityCode(ctx, a.userId, other);
        await addIdentity(ctx, a.userId, other, lastCode());
        expect(await code(auth.signIn(other, a.password))).toBe("invalid_credentials");
      });
    });

    describe("sessions", () => {
      it("a cookie token resolves to its user until it expires or is revoked", async () => {
        const u = await makeUser(ctx);
        const s = await createSession(ctx, u.userId, { ip: "1.2.3.4", userAgent: "test" });
        expect(await resolveSession(ctx, s.token)).toMatchObject({ userId: u.userId });
        expect(await resolveSession(ctx, "not-a-token")).toBeNull();
        const [row] = await ctx.db.query<{ token_hash: string }>("select token_hash from sessions where user_id = $1", [u.userId]);
        expect(row!.token_hash).not.toBe(s.token); // only a hash is stored
        await revokeSession(ctx, s.token);
        expect(await resolveSession(ctx, s.token)).toBeNull();
        const t2 = await createSession(ctx, u.userId);
        ctx.clock.advance(15 * 86_400_000);
        expect(await resolveSession(ctx, t2.token)).toBeNull();
      });
      it("stays open for a week after the last visit, and every visit restarts that week", async () => {
        const HOUR = 3_600_000;
        const u = await makeUser(ctx);
        const s = await createSession(ctx, u.userId);
        expect(s.expiresAt.getTime() - ctx.now().getTime()).toBe(168 * HOUR);
        // visit on day 4: the week starts again from that moment
        ctx.clock.advance(96 * HOUR);
        const day4 = await resolveSession(ctx, s.token);
        expect(day4).toMatchObject({ userId: u.userId, refreshed: true });
        expect(day4!.expiresAt.getTime() - ctx.now().getTime()).toBe(168 * HOUR);
        // 167 hours after that visit it is still open (that is day 10 and 23 hours: past the original week)
        ctx.clock.advance(167 * HOUR);
        expect(await resolveSession(ctx, s.token)).toMatchObject({ userId: u.userId });
        // and a week of silence after the latest visit ends it
        const last = ctx.now();
        ctx.clock.advance(168 * HOUR + 60_000);
        expect(await resolveSession(ctx, s.token)).toBeNull();
        expect(last.getTime()).toBeLessThan(ctx.now().getTime());
      });
      it("busy use does not write on every request, only every few minutes", async () => {
        const u = await makeUser(ctx);
        const s = await createSession(ctx, u.userId);
        ctx.clock.advance(60_000);
        expect(await resolveSession(ctx, s.token)).toMatchObject({ refreshed: false });
        ctx.clock.advance(5 * 60_000);
        expect(await resolveSession(ctx, s.token)).toMatchObject({ refreshed: true });
      });
      it("a suspended user's session stops working at once", async () => {
        const u = await makeUser(ctx);
        const s = await createSession(ctx, u.userId);
        await ctx.db.query("update users set status = 'suspended' where id = $1", [u.userId]);
        expect(await resolveSession(ctx, s.token)).toBeNull();
      });
      it("keeps at most 20 sessions per user", async () => {
        const u = await makeUser(ctx);
        for (let i = 0; i < 23; i++) { await createSession(ctx, u.userId); ctx.clock.advance(1000); }
        const [c] = await ctx.db.query<{ n: number }>("select count(*)::int as n from sessions where user_id = $1", [u.userId]);
        expect(c!.n).toBe(20);
      });
      it("csrf tokens are tied to one session", async () => {
        const u = await makeUser(ctx);
        const a = await createSession(ctx, u.userId); const b = await createSession(ctx, u.userId);
        const sa = (await resolveSession(ctx, a.token))!; const sb = (await resolveSession(ctx, b.token))!;
        expect(csrfToken(ctx, sa.sessionId)).toBe(csrfToken(ctx, sa.sessionId));
        expect(csrfToken(ctx, sa.sessionId)).not.toBe(csrfToken(ctx, sb.sessionId));
      });
    });

    describe("extra emails", () => {
      it("sends a code, links the email as a sub-account that shares the wallet, and keeps the main email", async () => {
        const a = await signUp();
        const other = email();
        await sendIdentityCode(ctx, a.userId, other);
        expect(ctx.outbox.sent.at(-1)).toMatchObject({ kind: "identity_code", to: other });
        const bad = await err(addIdentity(ctx, a.userId, other, "000000"));
        expect(bad!.code).toBe("invalid_code");
        const added = await addIdentity(ctx, a.userId, other, lastCode());
        expect(added).toMatchObject({ email: other, isPrimary: false, earned: 0n });
        expect((await getMe(ctx, a.userId)).identities.map((i) => i.isPrimary)).toEqual([true, false]);
      });
      it("a code for one account cannot add the email to another", async () => {
        const a = await signUp(); const b = await signUp();
        const other = email();
        await sendIdentityCode(ctx, a.userId, other);
        expect(await code(addIdentity(ctx, b.userId, other, lastCode()))).toBe("invalid_code");
      });
      it("refuses an email another account holds, and stops at the cap", async () => {
        const a = await signUp(); const b = await signUp();
        expect(await code(sendIdentityCode(ctx, a.userId, b.email))).toBe("email_taken");
        for (let i = 0; i < 9; i++) { const e = email(); wait(); await sendIdentityCode(ctx, a.userId, e); await addIdentity(ctx, a.userId, e, lastCode()); }
        expect(await code(sendIdentityCode(ctx, a.userId, email()))).toBe("bad_request");
      });
    });

    describe("crypto helpers", () => {
      it("UPI encryption round-trips, uses a fresh nonce, and detects tampering", async () => {
        const key = Buffer.alloc(32, 9);
        const a = encryptUpi(key, "priya@okhdfc"); const b = encryptUpi(key, "priya@okhdfc");
        expect(a).not.toBe(b);
        expect(decryptUpi(key, a)).toBe("priya@okhdfc");
        const parts = a.split("."); parts[3] = Buffer.from("tampered").toString("base64url");
        expect(() => decryptUpi(key, parts.join("."))).toThrow();
        expect(() => decryptUpi(Buffer.alloc(32, 1), a)).toThrow();
      });
      it("password hashes are salted", async () => {
        expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
      });
    });

    it("housekeeping removes only stale auth rows", async () => {
      const u = await makeUser(ctx);
      await createSession(ctx, u.userId);
      ctx.clock.advance(20 * 86_400_000);
      const purged = await purgeExpired(ctx);
      expect(purged.sessions).toBeGreaterThanOrEqual(1);
      const [c] = await ctx.db.query<{ n: number }>("select count(*)::int as n from users where id = $1", [u.userId]);
      expect(c!.n).toBe(1);
    });
  });
}
