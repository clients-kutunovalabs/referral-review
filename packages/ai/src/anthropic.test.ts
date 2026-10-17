import { describe, expect, it } from "vitest";
import type { ScriptRequest } from "@rr/core";
import { aiNotConfigured, buildPrompt, createAnthropicAi } from "./index";

const req: ScriptRequest = { title: "CRM intro", description: "Reach a clinic owner.", keywords: ["reminders", "free trial"], tone: "friendly", language: "English", minWords: 40, maxWords: 90, style: "email" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("anthropic adapter", () => {
  it("sends only the allow-listed fields and returns the text", async () => {
    let seen: { url: string; headers: Record<string, string>; body: { model: string; max_tokens: number; system: string; messages: { content: string }[] } } | undefined;
    const ai = createAnthropicAi({ apiKey: "sk-test", model: "claude-haiku-5-5", fetch: (async (url: string, init: RequestInit) => { seen = { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) }; return reply({ content: [{ type: "text", text: "  Hello Dr. Rao.  " }] }); }) as typeof fetch });
    expect(await ai.generateScript(req)).toBe("Hello Dr. Rao.");
    expect(seen!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen!.headers["x-api-key"]).toBe("sk-test");
    expect(seen!.body.model).toBe("claude-haiku-5-5");
    const prompt = seen!.body.messages[0]!.content;
    expect(prompt).toContain("CRM intro"); expect(prompt).toContain("reminders; free trial"); expect(prompt).toContain("between 40 and 90 words"); expect(prompt).toContain("friendly");
    expect(buildPrompt(req)).toBe(prompt);
    expect(seen!.body.max_tokens).toBeLessThanOrEqual(2000);
  });
  it("fails clearly on provider errors, empty answers and timeouts", async () => {
    const mk = (f: typeof fetch, timeoutMs?: number) => createAnthropicAi({ apiKey: "k", model: "m", fetch: f, ...(timeoutMs ? { timeoutMs } : {}) });
    await expect(mk((async () => reply({}, 529)) as typeof fetch).generateScript(req)).rejects.toThrow("529");
    await expect(mk((async () => reply({ content: [] })) as typeof fetch).generateScript(req)).rejects.toThrow("no text");
    await expect(mk(((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch, 20).generateScript(req)).rejects.toThrow("aborted");
  });
  it("a site with no key refuses with a clear message", async () => {
    await expect(aiNotConfigured.generateScript(req)).rejects.toThrow("not enabled");
  });
});
