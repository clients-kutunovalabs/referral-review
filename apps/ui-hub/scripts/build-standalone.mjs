// pnpm --filter @rr/ui-hub build:standalone -> share/user-flow.html and share/admin-flow.html (repo root)
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";

const out = new URL("../../../share/", import.meta.url);
mkdirSync(out, { recursive: true });
for (const view of ["user", "admin"]) {
  execSync("pnpm exec vite build -c vite.standalone.config.ts", { stdio: "inherit", env: { ...process.env, VITE_STANDALONE_VIEW: view } });
  copyFileSync(new URL(`../dist-standalone/${view}/standalone.html`, import.meta.url), new URL(`${view}-flow.html`, out));
}
console.log("written: share/user-flow.html, share/admin-flow.html");
