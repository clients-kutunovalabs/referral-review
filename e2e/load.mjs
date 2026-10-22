// 50 people at once, end to end, against a running site (the same setup as e2e/README.md: containers, Postgres, mail sink).
// Every step runs for all users at the same time, so locks, limits and races are exercised for real. Prints what worked,
// what was refused (and whether that was expected), every 5xx, and response times per endpoint. Exit code 1 on a real failure.
//
//   USERS=50 BASE=http://localhost:3100 OWNER_EMAIL=... OWNER_PASSWORD=... node e2e/load.mjs
//   SPREAD_IPS=1 ...   gives every user its own address in X-Forwarded-For (run the site with TRUST_PROXY_HOPS=1 for this)
import { performance } from "node:perf_hooks";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3100";
const SINK = "http://127.0.0.1:2526";
const USERS = Number(process.env.USERS ?? 50);
const SLOTS = Math.max(1, Math.floor(USERS * 0.6)); // fewer slots than people: the claim race must give exactly this many
const SPREAD = process.env.SPREAD_IPS === "1";
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "owner@example.com";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD ?? "owner password 123";
const tag = Date.now().toString(36);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/* ---------- measuring ---------- */
const timings = new Map(); // "POST /api/claims" -> ms[]
const serverErrors = [];
const problems = [];   // real failures (exit 1)
const findings = [];   // things that work as built but matter (limits etc.)
const check = (ok, msg) => { if (!ok) problems.push(msg); return ok; };
const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
const route = (method, path) => `${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id").replace(/\?.*$/, "")}`;

/** A browser stand-in: cookie jar, CSRF token, optional own IP address. */
function client(ip) {
  let cookie = ""; let csrf = "";
  async function req(method, path, o = {}) {
    const headers = { origin: BASE, ...(o.headers ?? {}) };
    if (cookie) headers.cookie = cookie;
    if (ip) headers["x-forwarded-for"] = ip;
    if (csrf && method !== "GET") headers["x-csrf-token"] = csrf;
    let body;
    if (o.form) body = o.form; else if (o.json !== undefined) { body = JSON.stringify(o.json); headers["content-type"] = "application/json"; }
    const t0 = performance.now();
    const res = await fetch(BASE + path, { method, headers, body, redirect: "manual" });
    const text = await res.text();
    const ms = performance.now() - t0;
    const key = route(method, path);
    (timings.get(key) ?? timings.set(key, []).get(key)).push(ms);
    if (res.status >= 500) serverErrors.push(`${key} -> ${res.status} ${text.slice(0, 200)}`);
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.includes("Max-Age=0") ? "" : set.split(";")[0];
    let parsed = text; try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    if (parsed && typeof parsed === "object" && parsed.csrf) csrf = parsed.csrf;
    return { status: res.status, body: parsed, code: parsed?.error?.code };
  }
  return {
    get: (p) => req("GET", p), post: (p, json) => req("POST", p, { json }), del: (p) => req("DELETE", p),
    upload: (kind) => { const f = new FormData(); f.set("file", new File([PNG], "shot.png", { type: "image/png" })); return req("POST", `/api/uploads?kind=${kind}`, { form: f }); }
  };
}
const codeFor = async (email) => {
  for (let i = 0; i < 80; i++) {
    const m = await (await fetch(`${SINK}/last?to=${encodeURIComponent(email)}`)).json();
    if (m?.code) return m.code;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
};
const tally = (results) => results.reduce((m, r) => { const k = r.status === 200 ? "ok" : r.code ?? String(r.status); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const all = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
const section = (t) => console.log(`\n== ${t}`);

/* ---------- setup: owner and staff ---------- */
const owner = client(SPREAD ? "10.200.0.1" : undefined);
check((await owner.post("/api/auth/sign-in", { email: OWNER_EMAIL, password: OWNER_PASSWORD })).status === 200, "owner cannot sign in");

async function signUp(email, name, c) {
  const r1 = await c.post("/api/auth/request-code", { email, purpose: "signup", profile: { name } });
  if (r1.status !== 200) return { step: "request-code", r: r1 };
  const code = await codeFor(email);
  if (!code) return { step: "email", r: { status: 0, code: "no_email" } };
  const r2 = await c.post("/api/auth/verify-code", { email, code, purpose: "signup" });
  if (r2.status !== 200) return { step: "verify-code", r: r2 };
  const r3 = await c.post("/api/auth/set-password", { ticket: r2.body.ticket, password: "a long password 1" });
  return { step: "set-password", r: r3 };
}

section(`${USERS} people sign up at the same time (${SPREAD ? "each from its own address" : "all from one address, like an office"})`);
const users = Array.from({ length: USERS }, (_, i) => ({ i, email: `load${i}x${tag}@example.com`, c: client(SPREAD ? `10.100.${Math.floor(i / 200)}.${(i % 200) + 2}` : undefined) }));
const signups = await all(USERS, (i) => signUp(users[i].email, `Load User ${i}`, users[i].c));
const signupTally = signups.reduce((m, s) => { const k = s.r.status === 200 ? "ok" : `${s.step}:${s.r.code ?? s.r.status}`; m[k] = (m[k] ?? 0) + 1; return m; }, {});
console.log("sign-up results:", signupTally);
const active = users.filter((_, i) => signups[i].r.status === 200);
if (active.length < USERS) {
  const limited = signups.filter((s) => s.r.code === "rate_limited").length;
  if (limited && !SPREAD) findings.push(`From one address, only ${active.length} of ${USERS} could sign up: ${limited} hit the per-address sign-up limit (20 codes per 10 minutes). A whole office behind one internet connection cannot sign up together.`);
  else check(false, `sign-up failed for ${USERS - active.length} people: ${JSON.stringify(signupTally)}`);
}
if (active.length < 5) { console.log("Too few accounts to continue."); finish(); }

// staff: two reviewers and a payer, from the first accounts
const [rev1, rev2, payer] = active.slice(0, 3);
const workers = active.slice(3);
const roleR = await owner.post("/api/admin/roles", { name: `Reviewer ${tag}` });
await owner.post(`/api/admin/roles/${roleR.body.id}/permissions`, { permissions: ["review.decide"] });
const roleP = await owner.post("/api/admin/roles", { name: `Payer ${tag}` });
await owner.post(`/api/admin/roles/${roleP.body.id}/permissions`, { permissions: ["payout.mark_paid", "ticket.manage"] });
for (const [u, role] of [[rev1, roleR], [rev2, roleR], [payer, roleP]]) {
  const m = await owner.post("/api/admin/members", { email: u.email });
  check(m.status === 200, `could not add ${u.email} to the team: ${JSON.stringify(m.body)}`);
  check((await owner.post(`/api/admin/members/${m.body.id}/roles`, { roleIds: [role.body.id] })).status === 200, "could not give a role");
}

section("everyone loads their home screen at once");
console.log("me/tasks/wallet:", tally(await all(workers.length, async (i) => {
  const c = workers[i].c; const me = await c.get("/api/me"); workers[i].me = me.body;
  await c.get("/api/tasks"); await c.get("/api/claims"); return c.get("/api/wallet");
})));

section("extra emails: everyone adds two at once");
const extraTally = tally(await all(workers.length, async (i) => {
  const c = workers[i].c; let last;
  for (let k = 0; k < 2; k++) {
    const email = `load${workers[i].i}e${k}x${tag}@example.com`;
    const s = await c.post("/api/identities/send-code", { email });
    if (s.status !== 200) return s;
    const code = await codeFor(email);
    last = await c.post("/api/identities", { email, code });
    if (last.status !== 200) return last;
  }
  workers[i].me = (await c.get("/api/me")).body;
  return last;
}));
console.log("add-email results:", extraTally);
check((extraTally.ok ?? 0) === workers.length, `adding emails failed for some: ${JSON.stringify(extraTally)}`);

section(`claim race: ${workers.length} people, ${SLOTS} slots, everyone presses Claim at the same moment`);
const t1 = await owner.post("/api/admin/tasks", { title: `Race task ${tag}`, description: "Claim race under load.", siteUrl: "https://example.com/race", reward: "5000", slotsTotal: SLOTS, timerMinutes: null, activeUntil: null, textMode: "manual_pool", keywords: [], scripts: ["Script A", "Script B", "Script C"], maxClaimsPerAccount: null });
check(t1.status === 200, "could not create the race task: " + JSON.stringify(t1.body));
const claims = await all(workers.length, (i) => workers[i].c.post("/api/claims", { taskId: t1.body.id, identityId: workers[i].me.identities[0].id }));
const claimTally = tally(claims);
console.log("claims:", claimTally);
check((claimTally.ok ?? 0) === Math.min(SLOTS, workers.length), `expected exactly ${Math.min(SLOTS, workers.length)} claims to win, got ${claimTally.ok ?? 0}`);
check(Object.keys(claimTally).every((k) => k === "ok" || k === "slots_full"), `unexpected claim answers: ${JSON.stringify(claimTally)}`);
const winners = workers.filter((_, i) => claims[i].status === 200);
const scripts = winners.map((w) => claims[workers.indexOf(w)].body.assignedText);
const perScript = scripts.reduce((m, s) => { m[s] = (m[s] ?? 0) + 1; return m; }, {});
console.log("scripts handed out:", perScript);
check(Math.max(...Object.values(perScript)) - Math.min(...Object.values(perScript)) <= 1, "scripts were not shared out evenly");

section("the same email again (refused), a different email of the same person (allowed)");
const again = tally(await all(winners.length, (i) => winners[i].c.post("/api/claims", { taskId: t1.body.id, identityId: winners[i].me.identities[0].id })));
console.log("same email again:", again);
check(!again.ok, "an email claimed the same task twice");
const t2 = await owner.post("/api/admin/tasks", { title: `Open task ${tag}`, description: "No slot limit.", siteUrl: "https://example.com/open", reward: "2000", slotsTotal: null, timerMinutes: null, activeUntil: null, textMode: "none", keywords: [], scripts: [], maxClaimsPerAccount: null });
const second = tally(await all(winners.length, async (i) => {
  const a = await winners[i].c.post("/api/claims", { taskId: t2.body.id, identityId: winners[i].me.identities[1].id });
  const b = await winners[i].c.post("/api/claims", { taskId: t2.body.id, identityId: winners[i].me.identities[2].id });
  return a.status === 200 ? b : a;
}));
console.log("two other emails on an open task:", second);
check((second.ok ?? 0) === winners.length, "a person could not claim with their other emails");

section("everyone uploads a screenshot and submits at once");
const subTally = tally(await all(winners.length, async (i) => {
  const w = winners[i]; const up = await w.c.upload("proof");
  if (up.status !== 200) return up;
  return w.c.post(`/api/claims/${claims[workers.indexOf(w)].body.id}/submit`, { fileId: up.body.fileId, note: `Done by ${w.email}` });
}));
console.log("submissions:", subTally);
check((subTally.ok ?? 0) === winners.length, `some submissions failed: ${JSON.stringify(subTally)}`);

section("two reviewers work the same queue at the same time");
const queue = (await rev1.c.get("/api/admin/review?limit=1000")).body;
check(Array.isArray(queue) && queue.length >= winners.length, `review queue shows ${queue?.length} of ${winners.length}`);
const decisions = await Promise.all(queue.flatMap((q) => [
  rev1.c.post(`/api/admin/review/${q.id}/decide`, { outcome: 100, note: "Checked by reviewer 1" }),
  rev2.c.post(`/api/admin/review/${q.id}/decide`, { outcome: 100, note: "Checked by reviewer 2" })
]));
const decTally = tally(decisions);
console.log("decisions (each submission tried twice):", decTally);
check((decTally.ok ?? 0) === queue.length, `expected ${queue.length} decisions to win, got ${decTally.ok}`);
check((decTally.not_pending ?? 0) === queue.length, "the second reviewer was not refused every time");

section("payouts: everyone asks twice at the same moment, then the payer pays them all at once");
const reqs = await all(winners.length, (i) => Promise.all([
  winners[i].c.post("/api/payouts", { amountPaise: "3000", upi: `w${winners[i].i}@okbank` }),
  winners[i].c.post("/api/payouts", { amountPaise: "3000", upi: `w${winners[i].i}@okbank` })
]));
const reqTally = tally(reqs.flat());
console.log("payout requests (two per person):", reqTally);
check((reqTally.ok ?? 0) === winners.length, `expected one request each, got ${reqTally.ok}`);
const pending = ((await payer.c.get("/api/admin/payouts")).body ?? []).filter((p) => p.status === "pending");
const payTally = tally(await all(pending.length, async (i) => {
  const up = await payer.c.upload("payment_proof");
  return payer.c.post(`/api/admin/payouts/${pending[i].id}/pay`, { proofFileId: up.body.fileId });
}));
console.log("payments:", payTally);
check((payTally.ok ?? 0) === pending.length, `some payments failed: ${JSON.stringify(payTally)}`);
const wallets = await all(winners.length, (i) => winners[i].c.get("/api/wallet"));
check(wallets.every((w) => w.body.payouts.some((p) => p.status === "paid")), "a paid payout does not show as paid to its worker");
check(wallets.every((w) => BigInt(w.body.earned) === 5000n), "earned should be the Rs 50 approved for the race task (the open-task claims are never submitted)");

section("support: everyone opens a ticket; support answers them all");
const tickets = await all(winners.length, (i) => winners[i].c.post("/api/tickets", { title: `Question ${i}`, body: "When is the next task?" }));
check(tally(tickets).ok === winners.length, `tickets: ${JSON.stringify(tally(tickets))}`);
const replies = tally(await all(tickets.length, (i) => payer.c.post(`/api/admin/tickets/${tickets[i].body.id}/reply`, { body: "Tomorrow morning." })));
console.log("replies:", replies);
check((replies.ok ?? 0) === tickets.length, "some replies failed");

section("limits: someone guesses a password");
const victim = winners.at(-1);
const guesser = client(SPREAD ? "10.250.0.9" : undefined);
const guesses = [];
for (let k = 0; k < 6; k++) guesses.push((await guesser.post("/api/auth/sign-in", { email: victim.email, password: `wrong guess ${k}` })).code);
console.log("6 wrong guesses:", guesses.join(", "));
check(guesses.at(-1) === "rate_limited", "the 6th wrong guess was not refused");
const ownLogin = await client(SPREAD ? "10.250.0.10" : undefined).post("/api/auth/sign-in", { email: victim.email, password: "a long password 1" });
console.log("the real person, from their own address:", ownLogin.status === 200 ? "signed in" : ownLogin.code);
if (SPREAD) check(ownLogin.status === 200, "a stranger's guesses locked the real person out");
else if (ownLogin.status !== 200) findings.push("From one shared address, a stranger's 5 wrong guesses also lock the real person out for 15 minutes (they share the address).");

section("edge: one person adds 10 emails at the same moment (cap is 10 in total, they have 1)");
{
  const c = rev2.c; const emails = Array.from({ length: 10 }, (_, k) => `cap${k}x${tag}@example.com`);
  const sent = tally(await all(10, (k) => c.post("/api/identities/send-code", { email: emails[k] })));
  const codes = await all(10, (k) => codeFor(emails[k]));
  const added = tally(await all(10, (k) => c.post("/api/identities", { email: emails[k], code: codes[k] })));
  const count = (await c.get("/api/me")).body.identities.length;
  console.log("codes sent:", sent, "added:", added, "emails now:", count);
  check(count === 10, `the 10-email cap was not held under concurrency: ${count} emails`);
  check((added.ok ?? 0) === 9, `expected 9 of 10 adds to win, got ${JSON.stringify(added)}`);
}

section("edge: staff cannot pay their own payout; the owner can");
{
  const own = (await payer.c.get("/api/me")).body;
  const cl = await payer.c.post("/api/claims", { taskId: t2.body.id, identityId: own.identities[0].id });
  const up = await payer.c.upload("proof");
  const sub = await payer.c.post(`/api/claims/${cl.body.id}/submit`, { fileId: up.body.fileId });
  check(cl.status === 200 && sub.status === 200, `the payer could not claim and submit: ${cl.code ?? ""} ${sub.code ?? ""}`);
  const item = ((await rev1.c.get("/api/admin/review?limit=1000")).body ?? []).find((q) => q.worker === `Load User ${payer.i}`); // emails are masked in the queue
  check((await rev1.c.post(`/api/admin/review/${item?.id}/decide`, { outcome: 100, note: "ok" })).status === 200, "could not approve the payer's own work");
  const req = await payer.c.post("/api/payouts", { amountPaise: "2000", upi: `payer${tag}@okbank` });
  const proof = await payer.c.upload("payment_proof");
  const self = await payer.c.post(`/api/admin/payouts/${req.body.id}/pay`, { proofFileId: proof.body.fileId });
  console.log("payer pays themself:", self.code ?? self.status);
  check(self.status === 403, "staff could mark their own payout paid");
  const ownerProof = await owner.upload("payment_proof");
  check((await owner.post(`/api/admin/payouts/${req.body.id}/pay`, { proofFileId: ownerProof.body.fileId })).status === 200, "the owner could not pay a staff member's payout");
}

section("edge: a worker is suspended while their payout waits; another worker is deleted");
{
  const [s, d] = [winners[0], winners[1]];
  const req = await s.c.post("/api/payouts", { amountPaise: "2000", upi: `w${s.i}@okbank` });
  check(req.status === 200, "second payout request failed: " + JSON.stringify(req.body));
  check((await owner.post(`/api/admin/users/${s.me.userId}/status`, { status: "suspended" })).status === 200, "owner could not suspend");
  const proof = await payer.c.upload("payment_proof");
  const pay = await payer.c.post(`/api/admin/payouts/${req.body.id}/pay`, { proofFileId: proof.body.fileId });
  const rej = await payer.c.post(`/api/admin/payouts/${req.body.id}/reject`, { reason: "Account suspended" });
  console.log("pay a suspended worker:", pay.code, "| reject instead:", rej.status === 200 ? "ok" : rej.code);
  check(pay.code === "account_inactive" && rej.status === 200, "a suspended worker's payout was not handled as designed");
  const sClaim = await s.c.post("/api/claims", { taskId: t2.body.id, identityId: s.me.identities[0].id });
  check(sClaim.status !== 200, "a suspended worker could still claim");
  check((await owner.post(`/api/admin/users/${d.me.userId}/status`, { status: "deleted" })).status === 200, "owner could not delete");
  const dIn = await client(SPREAD ? "10.250.0.11" : undefined).post("/api/auth/sign-in", { email: d.email, password: "a long password 1" });
  const dOld = await d.c.get("/api/me");
  console.log("deleted account signs in:", dIn.code ?? dIn.status, "| its old session:", dOld.code ?? dOld.status);
  check(dIn.status !== 200 && dOld.status !== 200, "a deleted account can still get in");
}

section("edge: timed claims expire and free the slot (waits for the worker's 1-minute sweep)");
{
  const t3 = await owner.post("/api/admin/tasks", { title: `Timed task ${tag}`, description: "One slot, one minute.", siteUrl: "https://example.com/timed", reward: "1000", slotsTotal: 1, timerMinutes: 1, activeUntil: null, textMode: "none", keywords: [], scripts: [], maxClaimsPerAccount: null });
  const [a, b] = [winners[2], winners[3]];
  const first = await a.c.post("/api/claims", { taskId: t3.body.id, identityId: a.me.identities[0].id });
  const blocked = await b.c.post("/api/claims", { taskId: t3.body.id, identityId: b.me.identities[0].id });
  check(first.status === 200 && blocked.code === "slots_full", "the one-slot task did not fill");
  let freed = null;
  for (let k = 0; k < 30 && !freed; k++) {
    await new Promise((r) => setTimeout(r, 5000));
    const r = await b.c.post("/api/claims", { taskId: t3.body.id, identityId: b.me.identities[0].id });
    if (r.status === 200) freed = Math.round((Date.now() - Date.parse(first.body.expiresAt)) / 1000);
  }
  const mine = ((await a.c.get("/api/claims")).body ?? []).find((c) => c.id === first.body.id);
  console.log(`slot freed ${freed ?? "never"} s after the deadline; the first claim is now: ${mine?.status}`);
  check(freed !== null && mine?.status === "expired", "a timed claim did not expire");
  const late = await a.c.upload("proof");
  const lateSubmit = await a.c.post(`/api/claims/${first.body.id}/submit`, { fileId: late.body.fileId });
  check(lateSubmit.status !== 200, "proof was accepted after the claim expired");
}

section("browsers at the same time: 5 people open the app and sign in while the API is busy");
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--no-sandbox"] });
const busy = all(winners.length, (i) => winners[i].c.get("/api/tasks"));
const pageErrors = [];
const browsing = winners.slice(4, -1); // not the suspended, deleted or locked-out ones
const browserResults = await all(Math.min(5, browsing.length), async (i) => {
  const ctx = await browser.newContext(SPREAD ? { extraHTTPHeaders: { "x-forwarded-for": `10.240.0.${i + 2}` } } : {}); const p = await ctx.newPage();
  p.on("pageerror", (e) => pageErrors.push(String(e)));
  const t0 = performance.now();
  await p.goto(BASE + "/app");
  await p.getByLabel("Email").fill(browsing[i].email); await p.getByLabel("Password", { exact: true }).fill("a long password 1");
  await p.getByRole("button", { name: "Log in" }).click();
  const ok = await p.getByText(/Tasks|My tasks/).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
  const ms = Math.round(performance.now() - t0); await ctx.close();
  return { ok, ms };
});
await busy; await browser.close();
console.log("browser sign-ins:", browserResults.map((r) => (r.ok ? `${r.ms} ms` : "FAILED")).join(", "));
check(browserResults.every((r) => r.ok), "a browser sign-in failed under load");
check(!pageErrors.length, `script errors in the browser: ${pageErrors.slice(0, 3).join(" | ")}`);

finish();

function finish() {
  section("response times (ms)");
  const rows = [...timings.entries()].map(([k, a]) => ({ k, n: a.length, p50: Math.round(pct(a, 0.5)), p95: Math.round(pct(a, 0.95)), max: Math.round(Math.max(...a)) })).sort((a, b) => b.p95 - a.p95);
  for (const r of rows) console.log(`${r.k.padEnd(44)} n=${String(r.n).padStart(4)}  p50=${String(r.p50).padStart(5)}  p95=${String(r.p95).padStart(5)}  max=${String(r.max).padStart(5)}`);
  section("summary");
  console.log(`server errors (5xx): ${serverErrors.length}`); for (const e of serverErrors.slice(0, 10)) console.log("  ", e);
  console.log(`findings: ${findings.length}`); for (const f of findings) console.log("  -", f);
  console.log(`failures: ${problems.length}`); for (const p of problems) console.log("  x", p);
  process.exit(problems.length || serverErrors.length ? 1 : 0);
}
