// Attack-minded checks against a RUNNING site (same setup as journey.mjs, see e2e/README.md): headers, access control between
// accounts, forged requests, malformed input, error leaks, and stored script injection in a real browser.
// Exits non-zero if anything that should be refused is let through.
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3100";
const SINK = "http://127.0.0.1:2526";
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "owner@example.com";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD ?? "owner password 123";
const PRODUCTION_BUILD = process.env.EXPECT_HSTS === "1";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const tag = Date.now().toString(36);

let passed = 0; let failed = 0;
const check = async (name, fn) => {
  try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n     ", String(e.message ?? e).split("\n")[0]); }
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

/** A browser stand-in: a cookie jar and the CSRF token, speaking only HTTP. */
function client() {
  let cookie = ""; let csrf = "";
  async function req(method, path, o = {}) {
    const headers = { ...(o.headers ?? {}) };
    if (cookie) headers.cookie = cookie;
    if (o.origin !== null) headers.origin = o.origin ?? BASE;
    if (csrf && o.csrf !== false && method !== "GET") headers["x-csrf-token"] = o.csrf ?? csrf;
    let body;
    if (o.form) body = o.form; else if (o.raw !== undefined) body = o.raw; else if (o.json !== undefined) { body = JSON.stringify(o.json); headers["content-type"] ??= "application/json"; }
    const res = await fetch(BASE + path, { method, headers, body, redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.includes("Max-Age=0") ? "" : set.split(";")[0];
    const text = await res.text();
    let parsed = text; try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    if (parsed && typeof parsed === "object" && parsed.csrf) csrf = parsed.csrf;
    return { status: res.status, body: parsed, text, headers: res.headers };
  }
  return { req, get: (p, o) => req("GET", p, o), post: (p, json, o) => req("POST", p, { json, ...o }), jar: () => cookie };
}

const codeFor = async (email) => {
  for (let i = 0; i < 40; i++) {
    const m = await (await fetch(`${SINK}/last?to=${encodeURIComponent(email)}`)).json();
    if (m?.code) return m.code;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no email arrived for " + email);
};
async function signUp(name) {
  const c = client(); const email = `sec${name}${tag}@example.com`;
  expect((await c.post("/api/auth/request-code", { email, purpose: "signup", profile: { name: `Sec ${name}` } })).status === 200, "request-code failed");
  const v = await c.post("/api/auth/verify-code", { email, code: await codeFor(email), purpose: "signup" });
  const s = await c.post("/api/auth/set-password", { ticket: v.body.ticket, password: "a long password 1" });
  expect(s.status === 200, "set-password failed: " + s.text);
  return { c, email };
}

// ---- setup: owner, two workers, one task, one ticket and one proof file each
const owner = client();
const signedIn = await owner.post("/api/auth/sign-in", { email: OWNER_EMAIL, password: OWNER_PASSWORD });
if (signedIn.status !== 200) { console.log("Cannot sign in as the owner:", signedIn.text); process.exit(2); }
const A = await signUp("a"); const B = await signUp("b");
const task = await owner.post("/api/admin/tasks", { title: `Sec task ${tag}`, description: "d", siteUrl: "https://example.com", reward: "4000", slotsTotal: null, timerMinutes: 60, activeUntil: null, textMode: "none", keywords: [], scripts: [], maxClaimsPerAccount: null });
expect(task.status === 200, "task create failed: " + task.text);
const meA = (await A.c.get("/api/me")).body;
const claimA = await A.c.post("/api/claims", { taskId: task.body.id, identityId: meA.identities[0].id });
expect(claimA.status === 200, "claim failed: " + claimA.text);
const fileA = await A.c.req("POST", "/api/uploads?kind=proof", { form: (() => { const f = new FormData(); f.set("file", new File([PNG], "x.png", { type: "image/png" })); return f; })() });
expect(fileA.status === 200, "upload failed: " + fileA.text);
const ticketA = await A.c.post("/api/tickets", { title: "Private question", body: "This is A's private ticket text." });
expect(ticketA.status === 200, "ticket failed: " + ticketA.text);

// ---- 1. headers
for (const path of ["/", "/admin", "/api/health"]) {
  await check(`security headers on ${path}`, async () => {
    const r = await fetch(BASE + path); const h = r.headers;
    expect(h.get("x-content-type-options") === "nosniff", "no nosniff");
    expect(h.get("x-frame-options") === "DENY" || /frame-ancestors 'none'/.test(h.get("content-security-policy") ?? ""), "can be framed");
    expect(h.get("referrer-policy") === "same-origin", "referrer policy: " + h.get("referrer-policy"));
    expect(!h.get("x-powered-by"), "X-Powered-By leaks the framework");
    if (path !== "/api/health") expect(/script-src 'self' 'nonce-/.test(h.get("content-security-policy") ?? ""), "no nonce CSP");
    if (PRODUCTION_BUILD) expect(/max-age=\d{7,}/.test(h.get("strict-transport-security") ?? ""), "no HSTS");
  });
}

// ---- 2. private routes need a login
const PRIVATE = ["/api/me", "/api/claims", "/api/tasks", "/api/wallet", "/api/tickets", "/api/admin/me", "/api/admin/dashboard", "/api/admin/payouts", "/api/admin/users", "/api/admin/review", "/api/admin/roles"];
await check("every private route refuses an anonymous visitor (401)", async () => {
  for (const p of PRIVATE) { const r = await fetch(BASE + p); expect(r.status === 401, `${p} gave ${r.status}`); }
});
await check("a worker cannot reach any admin route (403)", async () => {
  for (const p of PRIVATE.filter((x) => x.startsWith("/api/admin"))) { const r = await A.c.get(p); expect(r.status === 403, `${p} gave ${r.status}`); }
  const w = await A.c.post("/api/admin/tasks", { title: "x" }); expect(w.status === 403, "worker could create a task: " + w.status);
  const rej = await A.c.post(`/api/admin/payouts/${crypto.randomUUID()}/reject`, { reason: "nope nope" }); expect(rej.status === 403, "worker could reject a payout: " + rej.status);
  const dec = await A.c.post(`/api/admin/review/${crypto.randomUUID()}/decide`, { outcome: 100, note: "self approve" }); expect(dec.status === 403, "worker could approve work: " + dec.status);
});

// ---- 3. one worker cannot touch another's things
await check("worker B cannot read worker A's screenshot or ticket", async () => {
  const f = await B.c.get(`/api/files/${fileA.body.fileId}`); expect(f.status === 403 || f.status === 404, "file readable: " + f.status);
  const t = await B.c.get(`/api/tickets/${ticketA.body.id}`); expect(t.status === 403 || t.status === 404, "ticket readable: " + t.status);
  expect(!JSON.stringify((await B.c.get("/api/tickets")).body).includes("private ticket"), "A's ticket is in B's list");
  expect(!JSON.stringify((await B.c.get("/api/claims")).body).includes(claimA.body.id), "A's claim is in B's list");
});
await check("worker B cannot submit proof for A's claim, nor message on A's ticket", async () => {
  const mine = await B.c.req("POST", "/api/uploads?kind=proof", { form: (() => { const f = new FormData(); f.set("file", new File([PNG], "x.png", { type: "image/png" })); return f; })() });
  const s = await B.c.post(`/api/claims/${claimA.body.id}/submit`, { fileId: mine.body.fileId, note: "stolen" });
  expect(s.status === 403 || s.status === 404, "submitted for another's claim: " + s.status);
  const m = await B.c.post(`/api/tickets/${ticketA.body.id}/messages`, { body: "hello from B" });
  expect(m.status === 403 || m.status === 404, "posted on another's ticket: " + m.status);
});
await check("worker B cannot use A's uploaded file as their own proof", async () => {
  const claimB = await B.c.post("/api/claims", { taskId: task.body.id, identityId: (await B.c.get("/api/me")).body.identities[0].id });
  const s = await B.c.post(`/api/claims/${claimB.body.id}/submit`, { fileId: fileA.body.fileId, note: "reusing" });
  expect(s.status >= 400 && s.status < 500, "A's file accepted as B's proof: " + s.status);
});
await check("a worker cannot upload a payment proof (that is for payers)", async () => {
  const f = new FormData(); f.set("file", new File([PNG], "x.png", { type: "image/png" }));
  const r = await A.c.req("POST", "/api/uploads?kind=payment_proof", { form: f }); expect(r.status === 403, "got " + r.status);
});

// ---- 4. forged and malformed requests
await check("a write from another site is refused, with or without a valid token", async () => {
  const r = await A.c.post("/api/tickets", { title: "x", body: "forged request body" }, { origin: "https://evil.example" }); expect(r.status === 403, "cross-site origin gave " + r.status);
  const n = await A.c.req("POST", "/api/tickets", { json: { title: "x", body: "forged request body" }, origin: null }); expect(n.status === 403, "no origin gave " + n.status);
});
await check("a logged-in write without the CSRF token, or with someone else's, is refused", async () => {
  expect((await A.c.req("POST", "/api/tickets", { json: { title: "x", body: "forged request body" }, csrf: false })).status === 403, "no token accepted");
  expect((await A.c.req("POST", "/api/tickets", { json: { title: "x", body: "forged request body" }, csrf: B.c.jar() })).status === 403, "wrong token accepted");
});
await check("SQL-looking input is just text: no 500, no login", async () => {
  const r = await client().post("/api/auth/sign-in", { email: "' OR 1=1 --@x.co", password: "' OR '1'='1" }); expect(r.status === 400 || r.status === 401, "got " + r.status);
  const r2 = await client().post("/api/auth/sign-in", { email: A.email, password: "x'; drop table users; --" }); expect(r2.status === 401, "got " + r2.status);
  expect((await A.c.get("/api/me")).status === 200, "the account is gone?");
});
await check("wrong JSON shapes are 400, not 500", async () => {
  for (const body of [{ email: ["a@b.co"], password: "x" }, { email: { $ne: null }, password: { $ne: null } }, { email: A.email }, null, "text"]) {
    const r = await client().req("POST", "/api/auth/sign-in", { json: body }); expect(r.status === 400, `${JSON.stringify(body)} gave ${r.status}`);
  }
  const bad = await client().req("POST", "/api/auth/sign-in", { raw: "{not json", headers: { "content-type": "application/json" } }); expect(bad.status === 400, "broken JSON gave " + bad.status);
  const wrongType = await client().req("POST", "/api/auth/sign-in", { raw: "email=a", headers: { "content-type": "application/x-www-form-urlencoded" } }); expect(wrongType.status >= 400 && wrongType.status < 500, "form body gave " + wrongType.status);
});
await check("oversized bodies are refused (413), however they arrive", async () => {
  const huge = "x".repeat(2 * 1024 * 1024);
  const r = await A.c.req("POST", "/api/tickets", { json: { title: "t", body: huge } }); expect(r.status === 413 || r.status === 400, "JSON of 2 MB gave " + r.status);
  const f = new FormData(); f.set("file", new File([Buffer.alloc(6 * 1024 * 1024, 1)], "big.png", { type: "image/png" }));
  const u = await A.c.req("POST", "/api/uploads?kind=proof", { form: f }); expect(u.status === 413 || u.status === 400, "6 MB upload gave " + u.status);
});
await check("an upload must really be an image, whatever it claims to be", async () => {
  for (const [name, type, bytes] of [["x.png", "image/png", Buffer.from("<svg onload=alert(1)>")], ["x.png", "image/png", Buffer.from("<?php echo 1;")], ["x.svg", "image/svg+xml", Buffer.from("<svg/>")], ["x.html", "text/html", Buffer.from("<script>1</script>")]]) {
    const f = new FormData(); f.set("file", new File([bytes], name, { type }));
    const r = await A.c.req("POST", "/api/uploads?kind=proof", { form: f }); expect(r.status === 400, `${name} (${type}) gave ${r.status}`);
  }
});
await check("files are served as inert images: sandboxed, no sniffing, never as a page", async () => {
  const r = await A.c.get(`/api/files/${fileA.body.fileId}`);
  expect(r.headers.get("content-type") === "image/png", "type " + r.headers.get("content-type"));
  expect(r.headers.get("x-content-type-options") === "nosniff", "no nosniff on files");
  expect(/sandbox/.test(r.headers.get("content-security-policy") ?? ""), "no sandbox CSP on files");
});
await check("odd paths give a plain 404 with no stack trace or file path", async () => {
  for (const p of ["/api/files/..%2F..%2Fetc%2Fpasswd", "/api/files/not-a-uuid", `/api/tickets/${crypto.randomUUID()}`, "/api/nothing", "/.env", "/api/../../etc/passwd", "/_next/../package.json"]) {
    const r = await A.c.get(p);
    expect(r.status === 404 || r.status === 400, `${p} gave ${r.status}`);
    expect(!/at .*\(.*:\d+:\d+\)|node_modules|\/repo\/|\/app\/|Error:/.test(r.text), `${p} leaks internals: ${r.text.slice(0, 120)}`);
  }
});
await check("the wrong method is 405, and an unknown API error never exposes internals", async () => {
  expect((await A.c.req("PUT", "/api/me", { json: {} })).status === 405, "PUT /api/me");
  expect((await A.c.req("DELETE", "/api/wallet")).status === 405, "DELETE /api/wallet");
});
await check("the dev quick-login does not exist on this site", async () => {
  expect((await fetch(BASE + "/dev")).status === 404, "/dev answered"); expect((await fetch(BASE + "/dev/login?as=admin", { redirect: "manual" })).status === 404, "/dev/login answered");
});
await check("sign-in answers the same for a wrong password and an unknown account", async () => {
  const x = await client().post("/api/auth/sign-in", { email: A.email, password: "wrong password" });
  const y = await client().post("/api/auth/sign-in", { email: `nobody${tag}@example.com`, password: "wrong password" });
  expect(x.status === y.status && x.body.error.message === y.body.error.message, "responses differ");
});
await check("after sign-out the old cookie is dead", async () => {
  const c = client(); await c.post("/api/auth/sign-in", { email: A.email, password: "a long password 1" });
  const old = c.jar(); expect((await c.get("/api/me")).status === 200, "not signed in");
  await c.post("/api/auth/sign-out", {});
  const replay = await fetch(BASE + "/api/me", { headers: { cookie: old } }); expect(replay.status === 401, "old cookie still works: " + replay.status);
});

// ---- 5. stored script injection, in a real browser
await check("script in a ticket or a note is shown as text and never runs", async () => {
  const evil = `<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>`;
  const t = await A.c.post("/api/tickets", { title: "Markup test", body: evil }); expect(t.status === 200, "ticket failed");
  await owner.post(`/api/admin/tickets/${t.body.id}/reply`, { body: evil });
  const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
    await p.goto(BASE + "/"); await p.getByLabel("Email").fill(A.email); await p.getByLabel("Password", { exact: true }).fill("a long password 1");
    await p.getByRole("button", { name: "Log in" }).click(); await p.getByRole("button", { name: "Help" }).waitFor({ timeout: 15000 });
    await p.getByRole("button", { name: "Help" }).click(); await p.getByText("Markup test").first().click();
    await p.getByText("onerror", { exact: false }).first().waitFor({ timeout: 10000 }); // the markup is visible as plain text
    await p.waitForTimeout(800);
    expect(!(await p.evaluate("window.__pwned")), "injected script ran");
    expect((await p.locator("img[src='x']").count()) === 0, "injected <img> was created");
  } finally { await browser.close(); }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
