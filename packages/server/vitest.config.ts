import { defineConfig } from "vitest/config";

// Each test file boots a database (PGlite takes a few seconds), so give tests room.
export default defineConfig({ test: { testTimeout: 120_000, hookTimeout: 120_000 } });
