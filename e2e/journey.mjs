// The whole product, end to end, in real browsers against a running site: a worker on a phone and an admin on a desktop.
// Setup and how to run: e2e/README.md
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3100";
const SINK = "http://127.0.0.1:2526";
const OUT = process.argv[2] ?? "e2e/out";
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "owner@example.com";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD ?? "owner password 123";
const OWNER_NAME = process.env.OWNER_NAME ?? "Olivia Owner";
mkdirSync(OUT, { recursive: true });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--no-sandbox"] });
let passed = 0; let failed = 0;
const problems = [];
const TAG = Date.now().toString(36);
const UPI = `asha${TAG}@okhdfc`; // one UPI ID belongs to one worker, so every run uses its own
const BAD_UPI = `ashx${TAG}@okhdfc`;
let WORKER_PW = "a long password 1"; // changes mid-journey
const step = async (name, fn) => {
  try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n     ", String(e).split("\n")[0]); }
};
const watch = (page, label) => {
  page.on("pageerror", (e) => problems.push(`${label} pageerror: ${e}`));
  // The browser logs every 4xx as a console error; the tests below provoke those on purpose, so only real script errors and 5xx count.
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(`${label} console: ${m.text()}`); });
  page.on("response", (r) => { if (r.status() >= 500) problems.push(`${label} ${r.status()} ${r.url()}`); });
};
const see = (page, text, timeout = 10000) => page.getByText(text).first().waitFor({ timeout });
const codeFor = async (email) => {
  for (let i = 0; i < 40; i++) {
    const m = await (await fetch(`${SINK}/last?to=${encodeURIComponent(email)}`)).json();
    if (m?.code) return m;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no email arrived for " + email);
};
const upload = (page, name = "shot.png") => page.locator('input[type="file"]').first().setInputFiles({ name, mimeType: "image/png", buffer: PNG });

const run = Date.now().toString(36);
const WORKER = `asha${run}@example.com`;
const TASK = `Introduce the CRM ${run}`;
const NAME = `Asha ${run}`;

const wctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const actx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const w = await wctx.newPage(); const a = await actx.newPage();
watch(w, "worker"); watch(a, "admin");

// -------- worker signs up --------
await step("worker: sees the login screen, not a flash of the wrong layout", async () => {
  const res = await w.goto(BASE + "/");
  await see(w, "Log in");
  const csp = res.headers()["content-security-policy"] ?? "";
  if (!/script-src 'self' 'nonce-/.test(csp) || !/frame-ancestors 'none'/.test(csp)) throw new Error("CSP missing: " + csp);
  if (res.headers()["x-frame-options"] !== "DENY") throw new Error("no X-Frame-Options");
});
await step("worker: creates an account with an emailed one-time code", async () => {
  await w.getByRole("button", { name: "Create account" }).click();
  await w.getByLabel("Full name").fill(NAME);
  await w.getByLabel("Phone").fill("9876543210");
  await w.getByLabel("Email").fill(WORKER);
  await w.getByRole("button", { name: "Send code" }).click();
  await see(w, "We sent a 6-digit code");
  const mail = await codeFor(WORKER);
  if (!/sign-up/i.test(mail.subject)) throw new Error("wrong email subject: " + mail.subject);
  await w.getByLabel("Verification code").fill("000000");
  await w.getByRole("button", { name: "Verify email" }).click();
  await see(w, "attempts left");
  await w.getByLabel("Verification code").fill(mail.code);
  await w.getByRole("button", { name: "Verify email" }).click();
  await see(w, "Choose a password");
  await w.getByLabel("Password", { exact: true }).fill(WORKER_PW);
  await w.getByLabel("Confirm password").fill(WORKER_PW);
  await w.getByRole("button", { name: "Create account" }).click();
  await w.getByRole("button", { name: /Switch email/ }).waitFor({ timeout: 10000 });
});

// -------- admin publishes a task --------
await step("admin: logs in, the dashboard greets them, the sidebar shows (desktop layout)", async () => {
  await a.goto(BASE + "/admin");
  await a.getByLabel("Email").fill(OWNER_EMAIL);
  await a.getByLabel("Password", { exact: true }).fill("wrong password");
  await a.getByRole("button", { name: "Log in", exact: true }).click();
  await see(a, "Email or password is incorrect");
  await a.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
  await a.getByRole("button", { name: "Log in", exact: true }).click();
  await see(a, `Welcome back, ${OWNER_NAME}`);
  if (!(await a.locator(".bottomnav .nav-brand").isVisible())) throw new Error("no sidebar");
  await a.screenshot({ path: `${OUT}/admin-dashboard.png` });
});
await step("admin: publishes a task with scripts", async () => {
  await a.locator(".bottomnav").getByRole("button", { name: "Tasks" }).click();
  await a.getByRole("button", { name: "New task" }).click();
  await a.getByLabel("Title").fill(TASK);
  await a.getByLabel("Instructions").fill("Reach a clinic owner and screenshot the chat.");
  await a.getByLabel("Site link (where the work is done)").fill("https://example.com/crm");
  await a.getByLabel("Reward (₹)").fill("40");
  await a.getByLabel("Total slots").fill("5");
  await a.getByLabel("Time limit (hours)").fill("1");
  await a.getByRole("radio", { name: "Manual" }).click();
  await a.getByPlaceholder("Write the script here").fill("Hi Dr. Rao, could I show you a 10-minute demo?");
  await a.getByRole("button", { name: "Publish task" }).click();
  await see(a, "Task published");
  await see(a, TASK);
});
await step("admin: cannot publish an AI-script task when no AI key is set", async () => {
  await a.getByRole("button", { name: "New task" }).click();
  await a.getByLabel("Title").fill("AI task");
  await a.getByLabel("Instructions").fill("Write a long enough description for the AI to use.");
  await a.getByLabel("Site link (where the work is done)").fill("https://example.com/ai");
  await a.getByLabel("Reward (₹)").fill("10");
  await a.getByRole("radio", { name: "AI" }).click();
  await a.getByPlaceholder("Type and press Add").fill("pricing");
  await a.getByRole("button", { name: "Add", exact: true }).click();
  await a.getByLabel("Tone (required)").selectOption("friendly");
  await a.getByLabel("Script style (required)").selectOption("email");
  await a.getByLabel("Language (required)").fill("English");
  await a.getByLabel("Min words").fill("20"); await a.getByLabel("Max words").fill("60");
  await a.getByRole("button", { name: "Publish task" }).click();
  await see(a, "AI scripts are not enabled on this site");
  await a.getByRole("button", { name: "Back" }).click();
});

// -------- worker claims and submits --------
await step("worker: sees the task, claims it and gets a script", async () => {
  await w.reload();
  await see(w, TASK);
  await w.getByText(TASK).first().click();
  await see(w, "Task details");
  await w.getByRole("button", { name: "Claim task" }).click();
  await see(w, "Task accepted");
  await w.getByRole("button", { name: "Go to My tasks" }).click();
  await see(w, "Submit proof");
  const script = await w.getByLabel("Script to use").inputValue();
  if (!script.includes("Dr. Rao")) throw new Error("no script: " + script);
  await see(w, "left"); // the countdown
});
await step("worker: submits a screenshot and a note", async () => {
  await w.getByRole("button", { name: "Submit proof" }).click();
  await see(w, "Upload a screenshot");
  await w.getByRole("button", { name: "Submit for review" }).click();
  await see(w, "Attach a screenshot first");
  await upload(w);
  await w.getByPlaceholder("Anything the reviewer should know").fill("Spoke to the owner, demo booked.");
  await w.getByRole("button", { name: "Submit for review" }).click();
  await see(w, "Proof submitted");
});

// -------- admin reviews --------
await step("admin: sees the submission in the queue, with the screenshot, and credits 75%", async () => {
  await a.locator(".bottomnav").getByRole("button", { name: /Review queue/ }).click();
  await a.getByRole("row", { name: new RegExp(TASK) }).click();
  await see(a, "Note from user");
  await a.locator("img.proof-img").waitFor();
  const ok = await a.locator("img.proof-img").evaluate((i) => i.complete && i.naturalWidth > 0);
  if (!ok) throw new Error("the screenshot did not load");
  await a.getByRole("radio", { name: "75%" }).click();
  await a.getByRole("button", { name: "Submit review" }).click();
  await see(a, "A note is required");
  await a.getByPlaceholder("Explain the outcome, even when approving in full").fill("Missing the call length.");
  await a.screenshot({ path: `${OUT}/admin-review.png` });
  await a.getByRole("button", { name: "Submit review" }).click();
  await see(a, "Reviewed: 75% credited");
});

// -------- worker sees result, asks for payout --------
await step("worker: sees the partial approval, the note and the money in the wallet", async () => {
  await w.getByRole("button", { name: "My tasks" }).click();
  await w.getByRole("tab", { name: /Completed/ }).click();
  await see(w, "Partial · 75%");
  await see(w, "Missing the call length");
  await see(w, "₹30 of ₹40");
  await w.getByRole("button", { name: "Wallet" }).click();
  await see(w, "Withdrawable balance");
  const text = await w.locator(".screen").innerText();
  if (!/Total earned\s*₹30/.test(text) || !/Withdrawable balance\s*₹30/.test(text)) throw new Error("wallet totals wrong:\n" + text);
});
await step("worker: asks for a payout to a wrong UPI ID; the payer rejects it with a reason; the money is free again and the worker sees why", async () => {
  await w.getByRole("button", { name: "Payout", exact: true }).click();
  await w.getByLabel("Amount (₹)").fill("20");
  await w.getByLabel("UPI ID").fill(BAD_UPI);
  await w.getByRole("button", { name: "Request payout" }).click();
  await see(w, "Payout requested");
  await a.locator(".bottomnav").getByRole("button", { name: "Payouts" }).click();
  await a.getByRole("row", { name: new RegExp(NAME) }).first().click();
  await a.getByRole("button", { name: "Reject the request" }).click();
  await a.getByLabel(/Why is it rejected/).fill("UPI ID is invalid. Check it and try again.");
  await a.getByRole("button", { name: "Reject request" }).click();
  await w.reload();
  await w.getByRole("button", { name: "Payout", exact: true }).click();
  await see(w, "was rejected: UPI ID is invalid");
  await w.getByRole("button", { name: "Wallet" }).click();
  await see(w, "Withdrawable balance");
  const t = await w.locator(".screen").innerText();
  if (!/Withdrawable balance\s*₹30/.test(t)) throw new Error("rejected amount was not released:\n" + t);
});
await step("worker: requests a payout, which is held from the balance at once", async () => {
  await w.getByRole("button", { name: "Payout", exact: true }).click();
  await w.getByLabel("Amount (₹)").fill("500");
  await w.getByLabel("UPI ID").fill(UPI);
  await w.getByRole("button", { name: "Request payout" }).click();
  await see(w, "You can withdraw up to ₹30");
  await w.getByLabel("Amount (₹)").fill("20");
  await w.getByRole("button", { name: "Request payout" }).click();
  await see(w, "Payout requested");
  await w.getByRole("button", { name: "View payout requests" }).click();
  await see(w, "is processing and blocked");
  await see(w, "Withdrawable balance");
  const t = await w.locator(".screen").innerText();
  if (!/Withdrawable balance\s*₹10/.test(t)) throw new Error("balance not held:\n" + t);
});

// -------- admin pays --------
await step("admin: sees the full UPI ID only on the payout screen, pays with a screenshot", async () => {
  await a.reload(); // the open list refreshes itself every 30 seconds; the test does not wait for that
  await a.locator(".bottomnav").getByRole("button", { name: "Payouts" }).click();
  const list = await a.locator(".screen").innerText();
  if (list.includes(UPI)) throw new Error("full UPI ID leaked into the list");
  await a.getByRole("row", { name: new RegExp(NAME) }).first().click(); // the open request is listed above the rejected one
  await see(a, UPI);
  const pay = a.getByRole("button", { name: new RegExp(`Mark as paid by ${OWNER_NAME}`) });
  if (await pay.isEnabled()) throw new Error("Mark as paid must need the screenshot first");
  await upload(a, "payment.png");
  await pay.click();
  await see(a, `Recorded: paid by ${OWNER_NAME}`);
});
await step("worker: the request is now Paid and counted as withdrawn", async () => {
  await w.reload();
  await w.getByRole("button", { name: "Wallet" }).click();
  await see(w, "Total withdrawn");
  for (let i = 0; ; i++) {
    const t = (await w.locator(".screen").innerText()).replace(/\s+/g, " ");
    if (/Total withdrawn ₹20/.test(t)) break;
    if (i > 40) throw new Error("withdrawn never showed ₹20: " + t);
    await w.waitForTimeout(250);
  }
  await see(w, "Withdrawal");
});

// -------- support --------
await step("support: worker opens a ticket with an image, admin replies and resolves, worker reads it", async () => {
  await w.getByRole("button", { name: "Help" }).click();
  await w.getByRole("button", { name: "Create ticket" }).click();
  await w.getByLabel("Title").fill("Payout question");
  await w.getByLabel("Description").fill("When will my payout arrive in my bank?");
  await upload(w, "ticket.png");
  await w.getByRole("button", { name: "Submit ticket" }).click();
  await see(w, "Ticket created");

  await a.locator(".bottomnav").getByRole("button", { name: /Support/ }).click();
  await a.getByRole("row", { name: /Payout question/ }).click();
  await see(a, "When will my payout arrive");
  await a.getByPlaceholder("Reply to the customer").fill("It was paid today, check your bank.");
  await a.getByRole("button", { name: "Send" }).click();
  await see(a, "It was paid today");
  await a.getByRole("button", { name: "Mark resolved" }).click();
  await a.getByRole("button", { name: "Yes, resolve" }).click();
  await see(a, "Resolved. The conversation is read-only");

  await w.getByRole("button", { name: "Help" }).click();
  await w.getByRole("tab", { name: /Closed/ }).click();
  await w.getByText("Payout question").first().click();
  await see(w, "It was paid today");
  await see(w, "This ticket is resolved");
});

// -------- extra email --------
await step("worker: adds an extra email with its own code, and can claim as that email", async () => {
  const alt = `alt${run}@example.com`;
  await w.getByRole("button", { name: "Tasks", exact: true }).click();
  await w.getByRole("button", { name: /Switch email/ }).click();
  await see(w, "My emails");
  await w.getByLabel("New email").fill(alt);
  await w.getByRole("button", { name: "Send code" }).click();
  await see(w, "We sent a 6-digit code");
  const mail = await codeFor(alt);
  await w.getByLabel("Verification code").fill(mail.code);
  await w.getByRole("button", { name: "Verify email" }).click();
  await see(w, "Email verified and added");
  await see(w, alt);
});

await step("worker: changes the password (wrong current is refused), and the old password stops working", async () => {
  await w.getByRole("button", { name: "Change password" }).click();
  await w.getByLabel("Current password").fill("not my password");
  await w.getByLabel("New password", { exact: true }).fill("a brand new pass 2");
  await w.getByLabel("New password again").fill("a brand new pass 2");
  await w.getByRole("button", { name: "Save new password" }).click();
  await see(w, "Your current password is not right");
  await w.getByLabel("Current password").fill(WORKER_PW);
  await w.getByRole("button", { name: "Save new password" }).click();
  await see(w, "Password changed");
  const old = await w.evaluate(async ({ email, password }) => (await fetch("/api/auth/sign-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) })).status, { email: WORKER, password: WORKER_PW });
  if (old !== 401) throw new Error("the old password still signs in (status " + old + ")");
  WORKER_PW = "a brand new pass 2";
});

await step("worker: the browser Back and Forward buttons move between screens, and never back onto a sign-in screen", async () => {
  await w.getByRole("button", { name: "Tasks", exact: true }).click();
  await w.getByRole("button", { name: "My tasks" }).click();
  await see(w, "My tasks");
  await w.goBack();
  await w.getByRole("button", { name: /Switch email/ }).waitFor({ timeout: 5000 }); // the board again, still on the site
  if (!w.url().startsWith(BASE)) throw new Error("Back left the site: " + w.url());
  await w.goForward();
  await see(w, "My tasks");
  await w.getByRole("button", { name: "Tasks", exact: true }).click();
  await w.getByRole("button", { name: /^View/ }).first().click();
  await see(w, "Task details");
  await w.goBack();
  await w.getByRole("button", { name: /Switch email/ }).waitFor({ timeout: 5000 });
  if (await w.getByText("Task details").count()) throw new Error("the details sheet is still open after Back");
  await w.getByRole("button", { name: /Switch email/ }).click(); // where the next step expects to be
  await see(w, "My emails");
});
await step("admin: Back returns from a task to the task list", async () => {
  await a.getByRole("button", { name: "Tasks", exact: true }).first().click();
  await a.getByRole("row", { name: new RegExp(TASK) }).click();
  await a.getByRole("row", { name: new RegExp(TASK) }).waitFor({ state: "detached", timeout: 5000 }); // the list is replaced by the task
  await a.goBack();
  await a.getByRole("row", { name: new RegExp(TASK) }).waitFor({ timeout: 5000 });
  if (!a.url().startsWith(BASE)) throw new Error("Back left the site: " + a.url());
});

await step("worker: Reload and bookmarks stay on the same screen (the address shows it); a garbage address is ignored", async () => {
  await w.getByRole("button", { name: "Tasks", exact: true }).click();
  await w.getByRole("button", { name: "My tasks" }).click();
  await see(w, "My tasks");
  if (!/#\/mytasks/.test(w.url())) throw new Error("address does not show the screen: " + w.url());
  await w.reload();
  await see(w, "My tasks");
  if (!/#\/mytasks/.test(w.url())) throw new Error("reload lost the address: " + w.url());
  // a bookmark opened in a fresh tab of the same signed-in browser
  const tab = await wctx.newPage();
  await tab.goto(BASE + "/#/wallet");
  await tab.getByText(/Available|Wallet/).first().waitFor({ timeout: 10000 });
  await tab.close();
  // nonsense in the address must not break the app or open anything: it just lands on the board
  await w.goto(BASE + "/#/<img src=x onerror=window.__x=1>");
  await w.reload();
  await w.getByRole("button", { name: /Switch email/ }).waitFor({ timeout: 10000 });
  await w.goto(BASE + "/#/notAScreen?taskId=../../etc");
  await w.reload();
  await w.getByRole("button", { name: /Switch email/ }).waitFor({ timeout: 10000 });
  if (await w.evaluate("window.__x")) throw new Error("script from the address ran");
  await w.getByRole("button", { name: /Switch email/ }).click(); // where the next step expects to be
  await see(w, "My emails");
});
await step("admin: Reload on a task stays on that task", async () => {
  await a.getByRole("button", { name: "Tasks", exact: true }).first().click();
  await a.getByRole("row", { name: new RegExp(TASK) }).click();
  await a.getByRole("row", { name: new RegExp(TASK) }).waitFor({ state: "detached", timeout: 5000 });
  if (!/#\/taskdetail\?taskId=[0-9a-f-]{36}$/.test(a.url())) throw new Error("address does not show the task: " + a.url());
  await a.reload();
  await a.getByText(TASK).first().waitFor({ timeout: 10000 });
  if (await a.getByRole("row", { name: new RegExp(TASK) }).count()) throw new Error("reload went back to the list");
});

// -------- sign out, sessions end --------
await step("worker: logs out, and the session is really gone", async () => {
  await w.getByRole("button", { name: "Log out" }).click();
  await see(w, "Forgot password?");
  const r = await w.evaluate(async () => (await fetch("/api/me")).status);
  if (r !== 401) throw new Error("still signed in: " + r);
});
await step("a stranger cannot read another person's screenshot", async () => {
  const stranger = await browser.newContext(); const p = await stranger.newPage();
  await p.goto(BASE + "/");
  const status = await p.evaluate(async () => (await fetch("/api/files/00000000-0000-0000-0000-000000000000")).status);
  if (status !== 401) throw new Error("expected 401, got " + status);
  await stranger.close();
});

// -------- layouts --------
await step("the same site works at tablet and desktop widths too", async () => {
  await w.getByLabel("Email").fill(WORKER);
  await w.getByLabel("Password", { exact: true }).fill(WORKER_PW);
  await w.getByRole("button", { name: "Log in", exact: true }).click();
  await see(w, "Tasks");
  for (const [name, width, height] of [["tablet", 820, 1100], ["desktop", 1440, 900]]) {
    await w.setViewportSize({ width, height });
    await w.waitForTimeout(400);
    await w.screenshot({ path: `${OUT}/worker-${name}.png` });
  }
  await w.setViewportSize({ width: 390, height: 844 });
  await w.screenshot({ path: `${OUT}/worker-phone.png` });
});

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
if (problems.length) { console.log("\nbrowser problems:"); [...new Set(problems)].forEach((p) => console.log(" -", p)); }
process.exit(failed ? 1 : 0);
