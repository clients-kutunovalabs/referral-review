# @rr/ai

Script writer behind `AiPort`. `createAnthropicAi` calls Claude with only the allow-listed fields (`ScriptRequest`: title, description, keywords, tone, language, length, style), so no worker data can reach it. `aiNotConfigured` is used when there is no API key. `createMockAi` is for the gallery and tests.
