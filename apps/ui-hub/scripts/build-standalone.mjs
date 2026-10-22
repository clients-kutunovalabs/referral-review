// pnpm --filter @rr/ui-hub build:standalone -> share/user-flow.html and share/admin-flow.html (repo root)
// Each file is the whole app in one page (script, styles and fonts inside), so it opens from a download with no server.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const out = new URL("../../../share/", import.meta.url);
mkdirSync(out, { recursive: true });

/** Replaces the built page's script and stylesheet tags with their contents. Fails loudly if anything else is referenced. */
function inline(dir) {
  const read = (rel) => readFileSync(new URL(rel.replace(/^\.\//, ""), dir), "utf8");
  // "</script" inside the code would end the tag early; the escaped form means the same to JavaScript.
  const safeJs = (js) => js.replace(/<\/script/gi, "<\\/script");
  let html = read("standalone.html")
    .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_m, src) => `<script type="module">${safeJs(read(src))}</script>`)
    .replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_m, href) => `<style>${read(href)}</style>`);
  const left = /(?:src|href)="\.?\/?assets\//.exec(html);
  if (left) throw new Error(`standalone build still references a separate file: ${left[0]}`);
  return html;
}

for (const view of ["user", "admin"]) {
  execSync("pnpm exec vite build -c vite.standalone.config.ts", { stdio: "inherit", env: { ...process.env, VITE_STANDALONE_VIEW: view } });
  writeFileSync(new URL(`${view}-flow.html`, out), inline(new URL(`../dist-standalone/${view}/`, import.meta.url)));
}
console.log("written: share/user-flow.html, share/admin-flow.html");
