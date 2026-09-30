// Single-source-of-UI rule: stylesheets and UI components live in packages/ui only.
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const skip = new Set(["node_modules", "dist", ".next", ".git", "reference"]);
const bad = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else {
      const rel = relative(root, full);
      if (/\.(css|scss|sass|less)$/.test(name) && !rel.startsWith("packages/ui/")) bad.push(rel);
    }
  }
}
walk(root);

if (bad.length) {
  console.error("UI boundary violation: styles must live in packages/ui only:\n" + bad.join("\n"));
  process.exit(1);
}
console.log("UI boundaries OK");
