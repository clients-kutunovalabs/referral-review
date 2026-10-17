// `npm run dev` for people who only have npm. The project uses pnpm workspaces (npm cannot install them),
// so this script finds or fetches pnpm, installs once, then starts the site.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PNPM = "10.33.0";

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`Node 20 or newer is required (this is ${process.versions.node}). Install the current LTS from https://nodejs.org`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  // shell: true so Windows finds npx.cmd / pnpm.cmd; every argument here is a fixed literal.
  return spawnSync(cmd, args, { cwd: root, stdio: opts.quiet ? "ignore" : "inherit", shell: true, env: { ...process.env, RR_BOOTSTRAP: "1" } });
}

let pnpm = null;
if (run("pnpm", ["--version"], { quiet: true }).status === 0) pnpm = ["pnpm"];
else if (run("corepack", ["pnpm", "--version"], { quiet: true }).status === 0) pnpm = ["corepack", "pnpm"];
else pnpm = ["npx", "--yes", `pnpm@${PNPM}`];

const exec = (args) => {
  const r = run(pnpm[0], [...pnpm.slice(1), ...args]);
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!existsSync(join(root, "node_modules", ".pnpm")) || !existsSync(join(root, "apps", "web", "node_modules"))) {
  console.log("First run: installing dependencies (a few minutes)...");
  exec(["install", "--frozen-lockfile"]);
}

console.log("\nStarting the site at http://localhost:3000  (sign-up codes are printed in this window)\n");
exec(["--filter", "@rr/web", "dev"]);
