import { describe, expect, it } from "vitest";
import { AuthError, type AuthErrorCode } from "@rr/core";
import { createMockAuth, createMockEmailVerification, createOutbox } from "./mock";

function setup(extra: { fixedCode?: string } = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const outbox = createOutbox();
  const auth = createMockAuth({ now: clock.now, sender: outbox, ...extra });
  return { auth, outbox, clock };
}
const code = (o: { sent: { code: string }[] }) => o.sent[o.sent.length - 1]!.code;
async function failsWith(p: Promise<unknown>, expected: AuthErrorCode) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AuthError);
  expect((err as AuthError).code).toBe(expected);
}

describe("sign up: email -> code -> password", () => {
  it("creates the account, keeps the profile and signs in", async () => {
    const { auth, outbox } = setup();
    await auth.requestCode("New@Example.com ", "signup", { name: "Priya", phone: "9999999999" });
    expect(outbox.sent[0]).toMatchObject({ to: "new@example.com", kind: "signup_code", expiresInMinutes: 10 });
    expect(code(outbox)).toMatch(/^\d{6}$/);
    const { ticket } = await auth.verifyCode("new@example.com", code(outbox), "signup");
    const session = await auth.setPassword(ticket, "longenough1");
    expect(session.user).toMatchObject({ email: "new@example.com", emailVerified: true, profile: { name: "Priya", phone: "9999999999" } });
    expect(await auth.getSession()).toEqual(session);
    await auth.signOut();
    expect(await auth.getSession()).toBeNull();
    expect((await auth.signIn("NEW@example.com", "longenough1")).user.email).toBe("new@example.com");
  });
  it("rejects a bad email and an email that already has an account", async () => {
    const { auth } = setup();
    await failsWith(auth.requestCode("nope", "signup"), "invalid_email");
    // an existing email gets the same answer, but no code
    const outbox = createOutbox(); const t = createMockAuth({ users: [{ email: "a@b.co", password: "password1" }], sender: outbox });
    await expect(t.requestCode("a@b.co", "signup")).resolves.toBeDefined();
    expect(outbox.sent).toHaveLength(0);
  });
  it("short passwords do not burn the ticket", async () => {
    const { auth, outbox } = setup();
    await auth.requestCode("a@b.co", "signup");
    const { ticket } = await auth.verifyCode("a@b.co", code(outbox), "signup");
    await failsWith(auth.setPassword(ticket, "short"), "weak_password");
    expect((await auth.setPassword(ticket, "longenough1")).user.email).toBe("a@b.co");
  });
  it("a ticket works once and only for its own purpose", async () => {
    const { auth, outbox } = setup();
    await auth.requestCode("a@b.co", "signup");
    const { ticket } = await auth.verifyCode("a@b.co", code(outbox), "signup");
    await failsWith(auth.resetPassword(ticket, "longenough1"), "invalid_code");
    await auth.setPassword(ticket, "longenough1");
    await failsWith(auth.setPassword(ticket, "longenough1"), "invalid_code");
  });
});

describe("one-time code rules", () => {
  it("locks after 5 wrong codes, even for the right one, until a new code is requested", async () => {
    const { auth, outbox, clock } = setup();
    await auth.requestCode("a@b.co", "signup");
    const real = code(outbox);
    const wrong = real === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) await failsWith(auth.verifyCode("a@b.co", wrong, "signup"), "invalid_code");
    await failsWith(auth.verifyCode("a@b.co", wrong, "signup"), "too_many_attempts");
    await failsWith(auth.verifyCode("a@b.co", real, "signup"), "too_many_attempts");
    clock.advance(31_000);
    await auth.requestCode("a@b.co", "signup");
    await expect(auth.verifyCode("a@b.co", code(outbox), "signup")).resolves.toHaveProperty("ticket");
  });
  it("expires after 10 minutes", async () => {
    const { auth, outbox, clock } = setup();
    await auth.requestCode("a@b.co", "signup");
    clock.advance(10 * 60_000);
    await failsWith(auth.verifyCode("a@b.co", code(outbox), "signup"), "code_expired");
  });
  it("enforces a 30 second resend cooldown and 5 codes an hour", async () => {
    const { auth, clock } = setup();
    await auth.requestCode("a@b.co", "signup");
    await failsWith(auth.requestCode("a@b.co", "signup"), "rate_limited");
    for (let i = 0; i < 4; i++) { clock.advance(31_000); await auth.requestCode("a@b.co", "signup"); }
    clock.advance(31_000);
    await failsWith(auth.requestCode("a@b.co", "signup"), "rate_limited");
  });
  it("a fixed demo code is accepted for every request", async () => {
    const { auth } = setup({ fixedCode: "123456" });
    await auth.requestCode("a@b.co", "signup");
    await expect(auth.verifyCode("a@b.co", "123456", "signup")).resolves.toHaveProperty("ticket");
  });
});

describe("forgot and reset password", () => {
  it("resets the password and signs in", async () => {
    const outbox = createOutbox();
    const a = createMockAuth({ users: [{ email: "a@b.co", password: "oldpassword" }], sender: outbox });
    await a.requestCode("a@b.co", "reset");
    expect(outbox.sent[0]).toMatchObject({ kind: "reset_code" });
    const { ticket } = await a.verifyCode("a@b.co", code(outbox), "reset");
    await a.resetPassword(ticket, "newpassword1");
    await failsWith(a.signIn("a@b.co", "oldpassword"), "invalid_credentials");
    expect((await a.signIn("a@b.co", "newpassword1")).user.email).toBe("a@b.co");
  });
  it("does not reveal whether an email has an account", async () => {
    const { auth, outbox } = setup();
    await expect(auth.requestCode("ghost@b.co", "reset")).resolves.toMatchObject({ resendAfterSeconds: 30 });
    expect(outbox.sent).toHaveLength(0);
    await failsWith(auth.verifyCode("ghost@b.co", "123456", "reset"), "invalid_code");
  });
});

describe("sign in", () => {
  it("gives one generic error for a wrong password or unknown email, and locks after 5 failures", async () => {
    const { clock } = setup();
    const a = createMockAuth({ now: clock.now, users: [{ email: "a@b.co", password: "password1" }] });
    await failsWith(a.signIn("ghost@b.co", "password1"), "invalid_credentials");
    for (let i = 0; i < 4; i++) await failsWith(a.signIn("a@b.co", "wrongwrong"), "invalid_credentials");
    await failsWith(a.signIn("a@b.co", "wrongwrong"), "invalid_credentials");
    await failsWith(a.signIn("a@b.co", "password1"), "rate_limited");
    clock.advance(15 * 60_000);
    expect((await a.signIn("a@b.co", "password1")).user.email).toBe("a@b.co");
  });
});

describe("extra email verification (site-owned)", () => {
  it("sends one code per email and verifies it", async () => {
    const outbox = createOutbox();
    const v = createMockEmailVerification({ sender: outbox });
    await v.send("Second@Example.com");
    expect(outbox.sent[0]).toMatchObject({ to: "second@example.com", kind: "identity_code" });
    expect(() => v.check("second@example.com", code(outbox))).not.toThrow();
    expect(() => v.check("second@example.com", code(outbox))).toThrow(/not valid/);
  });
  it("an email another account holds gets the same answer but no code, so it can never be added", async () => {
    const outbox = createOutbox();
    const v = createMockEmailVerification({ isTaken: (e) => e === "taken@b.co", sender: outbox });
    await expect(v.send("taken@b.co")).resolves.toBeDefined();
    expect(outbox.sent).toHaveLength(0);
    expect(() => v.check("taken@b.co", "123456")).toThrow();
  });
});
