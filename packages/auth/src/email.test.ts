import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { createConsoleSender, createSmtpSender, renderEmail } from "./email";

describe("email", () => {
  it("renders one short plain-text message per kind and nothing else", () => {
    for (const kind of ["signup_code", "reset_code", "identity_code"] as const) {
      const r = renderEmail({ to: "a@b.co", kind, code: "123456", expiresInMinutes: 10 });
      expect(r.text).toContain("123456");
      expect(r.text).toContain("10 minutes");
      expect(r.text).not.toMatch(/https?:\/\//); // a code, never a link
      expect(r.subject.length).toBeGreaterThan(5);
    }
    expect(renderEmail({ to: "a@b.co", kind: "reset_code", code: "1", expiresInMinutes: 10 }).subject).toContain("reset");
  });
  it("the console sender prints the code for the developer", async () => {
    const lines: string[] = [];
    await createConsoleSender((l) => lines.push(l)).send({ to: "a@b.co", kind: "signup_code", code: "654321", expiresInMinutes: 10 });
    expect(lines[0]).toContain("a@b.co"); expect(lines[0]).toContain("654321");
  });
  it("gives up on a mail server that accepts the connection but never answers, instead of hanging sign-up", async () => {
    const silent = createServer(() => { /* accept and say nothing */ });
    await new Promise<void>((r) => silent.listen(0, "127.0.0.1", () => r()));
    const port = (silent.address() as { port: number }).port;
    try {
      const sender = createSmtpSender(`smtp://127.0.0.1:${port}`, "Tasks <no-reply@example.com>", { connectionTimeout: 500, greetingTimeout: 500, socketTimeout: 500 });
      const started = Date.now();
      await expect(sender.send({ to: "a@b.co", kind: "signup_code", code: "123456", expiresInMinutes: 10 })).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(5000);
    } finally { silent.close(); }
  });
});
