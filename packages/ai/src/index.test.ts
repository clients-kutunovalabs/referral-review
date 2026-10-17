import { describe, expect, it } from "vitest";
import { createMockAi } from "./index";

describe("mock ai", () => {
  it("writes from the keywords, falling back to the title", async () => {
    const ai = createMockAi();
    const base = { title: "CRM intro", description: "d", tone: "friendly", language: "English", minWords: 30, maxWords: 60, style: "cold_message" } as const;
    expect(await ai.generateScript({ ...base, keywords: ["reminders", "billing"] })).toContain("reminders and billing");
    expect(await ai.generateScript({ ...base, keywords: [] })).toContain("CRM intro");
  });
});
