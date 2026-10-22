// `npm run dev` for people who only have npm. The project uses pnpm workspaces (npm cannot install them),
// so this script finds or fetches pnpm, installs once, picks a free port, loads the root .env, then starts the site.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PNPM = "10.33.0";
const FIRST_PORT = 3000;
const LAST_PORT = 3100;

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`Node 20 or newer is required (this is ${process.versions.node}). Install the current LTS from https://nodejs.org`);
  process.exit(1);
}

/**
 * Development reads only these keys from the root .env. The rest of .env.example describes production (https URL, SMTP, a real
 * database), and copying that file whole must not turn a local run into a half-production one.
 */
const DEV_KEYS = new Set(["OWNER_EMAIL", "OWNER_NAME", "OWNER_PASSWORD", "ANTHROPIC_API_KEY", "AI_MODEL"]);

/** KEY=value lines of the root .env, limited to DEV_KEYS. Values already set in the shell win. */
function loadDotenv() {
  const file = join(root, ".env");
  if (!existsSync(file)) return [];
  const loaded = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#") || !DEV_KEYS.has(m[1])) continue;
    let value = m[2];
    const quoted = /^(["'])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/^#.*$/, "").replace(/\s+#.*$/, ""); // trailing comment
    if (value !== "" && process.env[m[1]] === undefined) { process.env[m[1]] = value; loaded.push(m[1]); }
  }
  return loaded;
}

/** A port is free only if nothing listens on it on either address family (another project may use 127.0.0.1 or ::). */
function isFree(port) {
  const tryHost = (host) => new Promise((resolve) => {
    const s = createServer();
    s.once("error", (e) => resolve(e.code !== "EADDRINUSE" && e.code !== "EACCES"));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
  return Promise.all([tryHost("127.0.0.1"), tryHost("::")]).then((r) => r.every(Boolean));
}

async function pickPort() {
  const wanted = process.env.PORT ? Number(process.env.PORT) : null;
  if (wanted) {
    if (!(await isFree(wanted))) { console.error(`Port ${wanted} (from PORT) is already in use. Pick another, or unset PORT to choose one automatically.`); process.exit(1); }
    return wanted;
  }
  for (let p = FIRST_PORT; p <= LAST_PORT; p++) if (await isFree(p)) return p;
  console.error(`No free port between ${FIRST_PORT} and ${LAST_PORT}. Set PORT=<number> and try again.`);
  process.exit(1);
}

// One command string (no argument array): Windows needs a shell to find npx.cmd / pnpm.cmd, and every part here is a fixed literal.
function run(command, quiet = false) {
  return spawnSync(command, { cwd: root, stdio: quiet ? "ignore" : "inherit", shell: true, env: { ...process.env, RR_BOOTSTRAP: "1" } });
}

let pnpm = `npx --yes pnpm@${PNPM}`;
if (run("pnpm --version", true).status === 0) pnpm = "pnpm";
else if (run("corepack pnpm --version", true).status === 0) pnpm = "corepack pnpm";

const exec = (args) => {
  const r = run(`${pnpm} ${args}`);
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!existsSync(join(root, "node_modules", ".pnpm")) || !existsSync(join(root, "apps", "web", "node_modules"))) {
  console.log("First run: installing dependencies (a few minutes)...");
  exec("install --frozen-lockfile");
}

const fromEnvFile = loadDotenv();
const port = await pickPort();
process.env.PORT = String(port);
// The site refuses writes whose origin differs from APP_URL, so in development it always follows the port actually chosen.
process.env.APP_URL = `http://localhost:${port}`;
process.env.DEV_LOGIN = "1"; // one-click sign-in for testing; the server refuses it in production

console.log(`\nStarting the site at http://localhost:${port}${port !== FIRST_PORT && !process.env.RR_PORT_QUIET ? `  (${FIRST_PORT} is taken by another program)` : ""}`);
if (fromEnvFile.length) console.log(`Loaded from .env: ${fromEnvFile.join(", ")}`);
console.log(`
  Landing page: http://localhost:${port}/
  Worker app:   http://localhost:${port}/app
  Admin app:    http://localhost:${port}/admin
  Launch pad:   http://localhost:${port}/dev            (one-click sign-in for both, with demo data)
    signed in as worker: http://localhost:${port}/dev/login?as=worker
    signed in as admin:  http://localhost:${port}/dev/login?as=admin
  Demo password for every demo account: dev password 123
  Sign-up codes are printed in this window.
`);
exec("--filter @rr/web dev");
