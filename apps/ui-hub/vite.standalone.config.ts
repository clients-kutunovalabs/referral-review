import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds ONE self-contained HTML file (JS, CSS and fonts inlined). Used by scripts/build-standalone.mjs.
const fonts = readFileSync(new URL("./standalone/fonts.inline.txt", import.meta.url), "utf8");
const view = process.env.VITE_STANDALONE_VIEW ?? "user";

export default defineConfig({
  plugins: [
    react(),
    { name: "inline-fonts", transformIndexHtml: (html) => html.replace("<!--FONTS-->", fonts) },
    viteSingleFile()
  ],
  build: { sourcemap: false, outDir: `dist-standalone/${view}`, emptyOutDir: true, rollupOptions: { input: "standalone.html" } }
});
