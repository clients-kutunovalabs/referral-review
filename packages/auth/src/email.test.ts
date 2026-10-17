import { describe, expect, it } from "vitest";
import { createConsoleSender, renderEmail } from "./email";

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
});
