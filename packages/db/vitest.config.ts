import { defineConfig } from "vitest/config";

// Every test boots its own database (PGlite takes a few seconds on a cold start, more on a busy CI runner), so give tests room.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
