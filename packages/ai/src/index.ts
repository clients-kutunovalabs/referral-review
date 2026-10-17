import type { AiPort, ScriptRequest } from "@rr/core";

/** Deterministic stand-in for ui-hub and tests. Uses only the allow-listed request fields. */
export function createMockAi(): AiPort {
  return {
    async generateScript(r: ScriptRequest) {
      const topic = r.keywords.join(" and ") || r.title;
      return `Hi, I wanted to follow up about ${topic}. We can get you set up quickly and our team will support the onboarding. Would you be open to a short call this week?`;
    }
  };
}

/** Placeholder for the real generator (Anthropic). It must send `ScriptRequest` and nothing else. */
export function createAnthropicAi(config: { apiKey: string }): AiPort {
  return { async generateScript() { throw new Error(config.apiKey ? "The AI adapter is not implemented yet." : "ANTHROPIC_API_KEY is not set."); } };
}
