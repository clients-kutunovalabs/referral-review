// Accessibility pass (WCAG 2.1 A/AA rules from axe-core) over every screen of both apps, at phone, tablet and desktop widths.
// Needs a site started with `npm run dev` (it uses the /dev quick login). Usage:  BASE=http://localhost:3000 node e2e/a11y.mjs
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const axeSource = readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const WIDTHS = { phone: { width: 390, height: 844 }, tablet: { width: 820, height: 1100 }, desktop: { width: 1366, height: 900 } };
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--no-sandbox"] });
const findings = new Map(); // key -> {impact, help, nodes:Set, where:Set}
let screens = 0;

async function scan(page, label) {
  await page.waitForTimeout(500);
  await page.evaluate(axeSource);
  const result = await page.evaluate(`axe.run(document, { runOnly: { type: "tag", values: ${JSON.stringify(TAGS)} } })`);
  screens++;
  for (const v of result.violations) {
    const f = findings.get(v.id) ?? { impact: v.impact, help: v.help, nodes: new Set(), where: new Set() };
    for (const n of v.nodes) f.nodes.add(n.target.join(" ") + " | " + (n.failureSummary ?? "").split("\n")[1]?.trim());
    f.where.add(label);
    findings.set(v.id, f);
  }
}

/** Every screen reachable from the app's navigation (bottom bar on phone, sidebar on tablet/desktop). */
async function walkNav(page, label) {
  const names = await page.evaluate(`(() => {
    const root = document.querySelector('.bottomnav, .sidebar, .rail, nav');
    return root ? [...root.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()).filter(Boolean) : [];
  })()`);
  const seen = new Set();
  for (const raw of names) {
    const name = raw.replace(/\s*\d+$/, "").trim();
    if (!name || seen.has(name) || /log ?out/i.test(name)) continue;
    seen.add(name);
    const btn = page.locator('.bottomnav, .sidebar, .rail, nav').first().getByRole("button", { name: new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first();
    if (!(await btn.count())) continue;
    await btn.click().catch(() => {});
    await scan(page, `${label} / ${name}`);
  }
  return [...seen];
}

for (const [wname, size] of Object.entries(WIDTHS)) {
  // signed out: the login and the sign-up screens
  {
    const ctx = await browser.newContext({ viewport: size, bypassCSP: true }); const p = await ctx.newPage();
    for (const path of ["/", "/admin"]) { await p.goto(BASE + path); await p.getByLabel("Password", { exact: true }).waitFor(); await scan(p, `${wname} ${path} login`); }
    await p.goto(BASE + "/"); await p.getByRole("button", { name: "Create account" }).click(); await scan(p, `${wname} sign up`);
    await p.goto(BASE + "/"); const forgot = p.getByRole("button", { name: /forgot/i }).first(); if (await forgot.count()) { await forgot.click(); await scan(p, `${wname} forgot password`); }
    await ctx.close();
  }
  for (const as of ["worker", "admin"]) {
    const ctx = await browser.newContext({ viewport: size, bypassCSP: true }); const p = await ctx.newPage();
    await p.goto(`${BASE}/dev/login?as=${as}`); await p.waitForTimeout(2500);
    await scan(p, `${wname} ${as} home`);
    await walkNav(p, `${wname} ${as}`);
    if (as === "worker") {
      // a task, a claim, the account screen
      const open = p.getByRole("button", { name: /^View/ }).first(); if (await open.count()) { await open.click(); await scan(p, `${wname} worker task detail`); }
      const sw = p.getByRole("button", { name: /Switch email|worker@dev\.local/ }).first(); if (await sw.count()) { await sw.click().catch(() => {}); await scan(p, `${wname} worker emails`); }
    }
    await ctx.close();
  }
}
await browser.close();

const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const list = [...findings.entries()].sort((a, b) => order[a[1].impact] - order[b[1].impact]);
console.log(`Scanned ${screens} screens (phone, tablet, desktop).`);
if (!list.length) console.log("No WCAG A/AA violations found.");
for (const [id, f] of list) {
  console.log(`\n[${f.impact}] ${id}: ${f.help}  (${f.nodes.size} element(s), on ${f.where.size} screen(s))`);
  for (const n of [...f.nodes].slice(0, 4)) console.log("   -", n.slice(0, 200));
  console.log("   screens:", [...f.where].slice(0, 5).join("; "));
}
const blocking = list.filter(([, f]) => f.impact === "critical" || f.impact === "serious");
process.exit(blocking.length ? 1 : 0);
