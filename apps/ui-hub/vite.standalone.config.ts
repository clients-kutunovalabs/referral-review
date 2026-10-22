import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds one page with exactly one script and one stylesheet, which scripts/build-standalone.mjs then inlines into a single
// self-contained HTML file (fonts are inlined here). No third-party bundling plugin is needed for that.
const fonts = readFileSync(new URL("./standalone/fonts.inline.txt", import.meta.url), "utf8");
const view = process.env.VITE_STANDALONE_VIEW ?? "user";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    { name: "inline-fonts", transformIndexHtml: (html) => html.replace("<!--FONTS-->", fonts) }
  ],
  build: {
    sourcemap: false, outDir: `dist-standalone/${view}`, emptyOutDir: true, cssCodeSplit: false, assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    modulePreload: false,
    rollupOptions: { input: "standalone.html", output: { inlineDynamicImports: true } }
  }
});
