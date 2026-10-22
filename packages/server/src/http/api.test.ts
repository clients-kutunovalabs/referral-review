/* eslint-disable @typescript-eslint/no-explicit-any -- the test client reads loosely-typed JSON bodies */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApi } from "./handler";
import { PNG, createTestCtx, engines, fund, makeAdmin, type TestCtx } from "../testing";

const BASE = "https://tasks.test";

interface Reply { status: number; body: any; headers: Headers }

/** A browser stand-in: keeps the cookie and the CSRF token the way the real pages do. */
function browser(api: (r: Request) => Promise<Response>, ip = "10.0.0.1") {
  let cookie = ""; let csrf = "";
  async function send(method: string, path: string, opts: { body?: unknown; form?: FormData; headers?: Record<string, string>; origin?: string | null } = {}): Promise<Reply> {
    const headers: Record<string, string> = { "x-forwarded-for": ip, ...(cookie ? { cookie } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}), ...opts.headers };
    if (opts.origin !== null) headers["origin"] = opts.origin ?? BASE;
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) { headers["content-type"] = headers["content-type"] ?? "application/json"; body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body); }
    const res = await api(new Request(BASE + path, { method, headers, ...(body !== undefined ? { body } : {}) }));
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.startsWith(`${set.split("=")[0]}=;`) ? "" : set.split(";")[0] as string;
    const text = await res.text();
    const parsed = text && res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text;
    if (parsed && typeof parsed === "object" && "csrf" in parsed && parsed.csrf) csrf = parsed.csrf;
    return { status: res.status, body: parsed, headers: res.headers };
  }
  return {
    get: (p: string, o?: Parameters<typeof send>[2]) => send("GET", p, o),
    post: (p: string, body?: unknown, o: Parameters<typeof send>[2] = {}) => send("POST", p, { body: body ?? {}, ...o }),
    del: (p: string) => send("DELETE", p),
    upload: (kind: string, bytes = PNG) => { const f = new FormData(); f.set("file", new File([bytes as BlobPart], "x.png", { type: "image/png" })); return send("POST", `/api/uploads?kind=${kind}`, { form: f }); },
    raw: send,
    forgetCookie: () => { cookie = ""; csrf = ""; }
  };
}

for (const engine of engines()) {
  describe(`HTTP API on ${engine}`, () => {
    let ctx: TestCtx; let api: (r: Request) => Promise<Response>;
    beforeAll(async () => { ctx = await createTestCtx(engine); api = createApi(ctx); });
    afterAll(() => ctx.close());

    let n = 0;
    const lastCode = () => ctx.outbox.sent[ctx.outbox.sent.length - 1]!.code;
    async function signUp(b: ReturnType<typeof browser>, name = "Asha Rao") {
      const email = `http${Date.now().toString(36)}${n++}@example.com`;
      expect((await b.post("/api/auth/request-code", { email, purpose: "signup", profile: { name, phone: "9876543210" } })).status).toBe(200);
      const v = await b.post("/api/auth/verify-code", { email, code: lastCode(), purpose: "signup" });
      const r = await b.post("/api/auth/set-password", { ticket: v.body.ticket, password: "correct horse 1" });
      expect(r.status).toBe(200);
      return { email, session: r.body };
    }
    /** Promotes an existing worker into an admin with these permissions, straight in the database. */
    async function makeAdminFor(email: string, perms: string[] | "all") {
      const [u] = await ctx.db.query<{ user_id: string }>("select user_id from identities where lower(email) = $1", [email]);
      await ctx.db.query("insert into admin_members (user_id, workspace_id) values ($1,$2)", [u!.user_id, ctx.cfg.workspaceId]);
      const [r] = await ctx.db.query<{ id: string }>("insert into roles (workspace_id, name) values ($1,$2) returning id", [ctx.cfg.workspaceId, `r${Math.random()}`]);
      const list = perms === "all" ? ["task.manage", "task_text.manage", "review.decide", "payout.mark_paid", "user.manage", "ticket.manage", "role.manage"] : perms;
      for (const p of list) await ctx.db.query("insert into role_permissions (role_id, permission) values ($1,$2)", [r!.id, p]);
      await ctx.db.query("insert into member_roles (user_id, role_id) values ($1,$2)", [u!.user_id, r!.id]);
    }

    describe("security", () => {
      it("refuses state-changing requests from other sites, or with no origin at all", async () => {
        const b = browser(api);
        expect((await b.post("/api/auth/sign-in", { email: "a@b.co", password: "x" }, { origin: "https://evil.example" })).body.error.code).toBe("csrf");
        expect((await b.raw("POST", "/api/auth/sign-in", { body: { email: "a@b.co", password: "x" }, origin: null })).status).toBe(403);
        expect((await b.raw("POST", "/api/auth/sign-in", { body: { email: "a@b.co", password: "x" }, origin: null, headers: { "sec-fetch-site": "same-origin" } })).status).toBe(401);
      });
      it("needs a login for everything private", async () => {
        const b = browser(api);
        for (const p of ["/api/me", "/api/tasks", "/api/claims", "/api/wallet", "/api/tickets", "/api/admin/dashboard", "/api/files/00000000-0000-0000-0000-000000000000"]) {
          expect((await b.get(p)).status).toBe(401);
        }
        expect((await b.get("/api/session")).body).toEqual({ session: null, csrf: null, isAdmin: false });
      });
      it("a logged-in write needs the session's own CSRF token", async () => {
        const b = browser(api); await signUp(b);
        const w = await b.raw("POST", "/api/tickets", { body: { title: "t", body: "long enough body" }, headers: { "x-csrf-token": "" } });
        expect(w.body.error.code).toBe("csrf");
        const other = browser(api, "10.0.0.2"); await signUp(other);
        const csrfOfOther = (await other.get("/api/session")).body.csrf;
        expect((await b.raw("POST", "/api/tickets", { body: { title: "t", body: "long enough body" }, headers: { "x-csrf-token": csrfOfOther } })).body.error.code).toBe("csrf");
        expect((await b.post("/api/tickets", { title: "t", body: "long enough body" })).status).toBe(200);
      });
      it("only accepts JSON, rejects unknown fields, and keeps request size small", async () => {
        const b = browser(api);
        expect((await b.raw("POST", "/api/auth/sign-in", { body: "email=a&password=b", headers: { "content-type": "application/x-www-form-urlencoded" } })).status).toBe(415);
        expect((await b.post("/api/auth/sign-in", { email: "a@b.co", password: "x", admin: true })).status).toBe(400);
        expect((await b.post("/api/auth/sign-in", "not json")).status).toBe(400);
        expect((await b.post("/api/auth/sign-in", { email: "a@b.co", password: "x".repeat(200_000) })).status).toBe(413);
      });
      it("enforces size limits on the bytes received, even with no Content-Length (a chunked body)", async () => {
        const stream = (bytes: number) => new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < bytes / 65536; i++) c.enqueue(new Uint8Array(65536)); c.close(); } });
        const post = async (path: string, bytes: number, type: string, cookie = "") => (await api(new Request(BASE + path, {
          method: "POST", headers: { origin: BASE, "content-type": type, "x-forwarded-for": "10.9.9.9", ...(cookie ? { cookie } : {}) }, body: stream(bytes), duplex: "half"
        } as RequestInit))).status;
        expect(await post("/api/auth/sign-in", 5 * 1024 * 1024, "application/json")).toBe(413); // JSON is capped at 100 KB
        const b = browser(api, "10.9.9.8"); await signUp(b);
        const up = await b.raw("POST", "/api/uploads?kind=proof", { headers: { "content-type": "multipart/form-data; boundary=x" }, body: "x".repeat(6 * 1024 * 1024) });
        expect(up.status).toBe(413);
        expect((await b.get("/api/me")).status).toBe(200); // and the server is still fine
      });
      it("a malformed id in a URL is a plain 404, never a server error", async () => {
        const b = browser(api); await signUp(b);
        for (const p of ["/api/tickets/not-a-uuid", "/api/files/abc", "/api/tickets/%E0%A4%A", "/api/claims/1/retry-text"]) {
          const r = p.includes("retry-text") ? await b.post(p) : await b.get(p);
          expect(r.status, p).toBe(404);
          expect(r.body.error.code).toBe("not_found");
        }
        expect((await b.get("/api/tickets/00000000-0000-0000-0000-000000000000")).status).toBe(404); // well formed but absent
      });
      it("answers with a clean error shape, correct statuses and safe headers", async () => {
        const b = browser(api);
        const r = await b.post("/api/auth/sign-in", { email: "nobody@example.com", password: "wrongwrong" });
        expect(r.status).toBe(401);
        expect(r.body).toEqual({ error: { code: "invalid_credentials", message: "Email or password is incorrect." } });
        expect(r.headers.get("cache-control")).toBe("no-store");
        expect(r.headers.get("x-content-type-options")).toBe("nosniff");
        expect((await b.get("/api/nothing")).status).toBe(404);
        expect((await b.raw("PUT", "/api/me", { body: {} })).status).toBe(405);
      });
      it("the session cookie is HttpOnly, SameSite and Secure, and sign-out ends it", async () => {
        const b = browser(api);
        const email = `ck${Date.now()}@example.com`;
        await b.post("/api/auth/request-code", { email, purpose: "signup", profile: { name: "Cookie" } });
        const v = await b.post("/api/auth/verify-code", { email, code: lastCode(), purpose: "signup" });
        const r = await b.post("/api/auth/set-password", { ticket: v.body.ticket, password: "correct horse 1" });
        const c = r.headers.get("set-cookie")!;
        expect(c).toMatch(/^__Host-rr_session=/);
        expect(c).toContain("HttpOnly"); expect(c).toContain("SameSite=Lax"); expect(c).toContain("Secure"); expect(c).toContain("Path=/");
        expect((await b.get("/api/me")).status).toBe(200);
        expect((await b.post("/api/auth/sign-out")).status).toBe(200);
        expect((await b.get("/api/me")).status).toBe(401);
      });
      it("rate limits sign-in attempts per address", async () => {
        const b = browser(api, "203.0.113.50");
        const results: number[] = [];
        for (let i = 0; i < 32; i++) results.push((await b.post("/api/auth/sign-in", { email: `x${i}@example.com`, password: "wrongwrong" })).status);
        expect(results.slice(0, 30).every((s) => s === 401)).toBe(true);
        const limited = await b.post("/api/auth/sign-in", { email: "x@example.com", password: "wrongwrong" });
        expect(limited.status).toBe(429);
        expect(limited.headers.get("retry-after")).toBeTruthy();
        const elsewhere = browser(api, "203.0.113.51");
        expect((await elsewhere.post("/api/auth/sign-in", { email: "x@example.com", password: "wrongwrong" })).status).toBe(401);
      });
      it("behind the trusted proxy, a forged X-Forwarded-For prefix does not buy a new rate-limit bucket", async () => {
        const mk = (spoof: string) => browser(api, `${spoof}, 203.0.113.77`);
        for (let i = 0; i < 30; i++) await mk(`1.1.1.${i}`).post("/api/auth/sign-in", { email: `y${i}@example.com`, password: "wrongwrong" });
        expect((await mk("9.9.9.9").post("/api/auth/sign-in", { email: "y@example.com", password: "wrongwrong" })).status).toBe(429);
      });
      it("workers cannot reach admin endpoints, and admins only reach what their roles allow", async () => {
        const w = browser(api); await signUp(w);
        expect((await w.get("/api/admin/dashboard")).status).toBe(403);
        expect((await w.get("/api/admin/tasks")).status).toBe(403);
        const a = browser(api, "10.0.0.9"); const { email } = await signUp(a);
        await makeAdminFor(email, ["review.decide"]);
        expect((await a.get("/api/admin/review")).status).toBe(200);
        expect((await a.get("/api/admin/payouts")).status).toBe(403);
        expect((await a.post("/api/admin/tasks", {})).status).toBe(400);
        expect((await a.get("/api/admin/me")).body.permissions).toEqual(["review.decide"]);
      });
      it("files are private to their owner and the staff who need them", async () => {
        const a = browser(api); await signUp(a);
        const b = browser(api, "10.0.0.3"); await signUp(b);
        const up = await a.upload("proof");
        expect(up.status).toBe(200);
        const mine = await a.get(`/api/files/${up.body.fileId}`);
        expect(mine.status).toBe(200);
        expect(mine.headers.get("content-type")).toBe("image/png");
        expect(mine.headers.get("content-security-policy")).toContain("sandbox");
        expect((await b.get(`/api/files/${up.body.fileId}`)).status).toBe(403);
        expect((await a.upload("payment_proof")).status).toBe(403); // not a payer
        expect((await a.upload("bogus")).status).toBe(400);
        const notImage = new FormData(); notImage.set("file", new File(["<script>alert(1)</script>"], "x.png", { type: "image/png" }));
        expect((await a.raw("POST", "/api/uploads?kind=proof", { form: notImage })).body.error.code).toBe("upload_invalid");
      });
    });

    describe("a whole cycle over HTTP", () => {
      it("sign up, claim, upload, submit, review, wallet, payout, pay, paid", async () => {
        const owner = browser(api, "10.1.0.1"); const o = await signUp(owner, "Owner Person");
        await makeAdminFor(o.email, "all");
        const worker = browser(api, "10.1.0.2"); const w = await signUp(worker, "Priya S.");
        expect(w.session.session.user.profile.name).toBe("Priya S.");

        const me = (await worker.get("/api/me")).body;
        expect(me).toMatchObject({ name: "Priya S.", isAdmin: false });
        expect(me.identities).toHaveLength(1);

        // admin publishes a task
        const created = await owner.post("/api/admin/tasks", {
          title: "Introduce the CRM", description: "Reach a clinic owner and screenshot the chat.", siteUrl: "https://example.com/crm", reward: "4000",
          slotsTotal: 5, timerMinutes: 30, activeUntil: null, textMode: "manual_pool", keywords: [], scripts: ["Hi Dr. Rao, a quick demo?", "Hello, free trial for your clinic?"], maxClaimsPerAccount: null
        });
        expect(created.status).toBe(200);
        expect(created.body.reward).toBe("4000"); // money travels as a string of paise
        const taskId = created.body.id;

        // worker finds it and claims it
        const board = (await worker.get("/api/tasks")).body;
        expect(board.find((t: any) => t.id === taskId)).toMatchObject({ reward: "4000", slotsRemaining: 5 });
        const claim = await worker.post("/api/claims", { taskId, identityId: me.identities[0].id });
        expect(claim.status).toBe(200);
        expect(claim.body).toMatchObject({ status: "claimed", reward: "4000", minutesLeft: 30 });
        expect(claim.body.assignedText).toMatch(/Dr\. Rao|free trial/);
        expect((await worker.post("/api/claims", { taskId, identityId: me.identities[0].id })).body.error.code).toBe("already_claimed");

        // proof
        const up = await worker.upload("proof");
        const sub = await worker.post(`/api/claims/${claim.body.id}/submit`, { fileId: up.body.fileId, note: "Spoke to the owner." });
        expect(sub.body.status).toBe("under_review");

        // admin reviews: sees the screenshot, decides 75%
        const queue = (await owner.get("/api/admin/review")).body;
        const item = queue.find((q: any) => q.taskTitle === "Introduce the CRM");
        expect(item.proofUrl).toMatch(/^\/api\/files\//);
        expect((await owner.get(item.proofUrl)).status).toBe(200);
        expect((await owner.post(`/api/admin/review/${item.id}/decide`, { outcome: 75, note: "Missing call length." })).status).toBe(200);
        expect((await owner.post(`/api/admin/review/${item.id}/decide`, { outcome: 100, note: "again" })).body.error.code).toBe("not_pending");
        expect((await owner.post(`/api/admin/review/${item.id}/decide`, { outcome: 60, note: "bad" })).status).toBe(400);

        // worker sees the result and the money
        const claims = (await worker.get("/api/claims")).body;
        expect(claims[0]).toMatchObject({ status: "partial", outcome: 75, credited: "3000", reviewerNote: "Missing call length." });
        let wallet = (await worker.get("/api/wallet")).body;
        expect(wallet).toMatchObject({ earned: "3000" });
        expect(wallet.entries[0]).toMatchObject({ credited: "3000", reward: "4000", outcome: 75 });

        // payout
        expect((await worker.post("/api/payouts", { amountPaise: "5000", upi: "priya@okhdfc" })).body.error.code).toBe("insufficient_balance");
        expect((await worker.post("/api/payouts", { amountPaise: 2000, upi: "priya@okhdfc" })).status).toBe(400); // a JSON number is refused
        const pay = await worker.post("/api/payouts", { amountPaise: "2500", upi: "priya@okhdfc" });
        expect(pay.status).toBe(200);
        expect(pay.body).toMatchObject({ status: "pending", amount: "2500", upiMasked: "pri••@okhdfc" });
        expect(pay.body.upiFull).toBeUndefined();

        // admin pays it
        const list = (await owner.get("/api/admin/payouts")).body;
        expect(list.find((p: any) => p.id === pay.body.id).upiFull).toBeUndefined();
        const detail = (await owner.get(`/api/admin/payouts/${pay.body.id}`)).body;
        expect(detail.upiFull).toBe("priya@okhdfc");
        expect((await owner.post(`/api/admin/payouts/${pay.body.id}/pay`, { proofFileId: up.body.fileId })).body.error.code).toBe("upload_invalid");
        const proof = await owner.upload("payment_proof");
        expect((await owner.post(`/api/admin/payouts/${pay.body.id}/pay`, { proofFileId: proof.body.fileId })).status).toBe(200);

        wallet = (await worker.get("/api/wallet")).body;
        expect(wallet.payouts[0]).toMatchObject({ status: "paid", amount: "2500" });
        expect((await owner.get(`/api/admin/payouts/${pay.body.id}`)).body.proofUrl).toMatch(/^\/api\/files\//);

        const dash = (await owner.get("/api/admin/dashboard")).body;
        expect(dash.payoutsDue).toBeGreaterThanOrEqual(0);
      });

      it("a payer rejects a request with a reason over HTTP; the worker sees it and can ask again", async () => {
        const owner = browser(api, "10.3.0.1"); const o = await signUp(owner, "Meera"); await makeAdminFor(o.email, "all");
        const worker = browser(api, "10.3.0.2"); const w = await signUp(worker, "Ravi");
        const other = browser(api, "10.3.0.3"); const x = await signUp(other, "Kiran");
        const idOf = async (email: string) => {
          const [r] = await ctx.db.query<{ user_id: string; id: string }>("select user_id, id from identities where lower(email) = $1", [email]);
          return { userId: r!.user_id, identityId: r!.id, email, name: email };
        };
        const staff = await makeAdmin(ctx, "all");
        await fund(ctx, await idOf(w.email), staff, staff, 100n);
        await fund(ctx, await idOf(x.email), staff, staff, 100n);
        const upi = `http${Date.now().toString(36)}@okbank`;
        const req = await worker.post("/api/payouts", { amountPaise: "3000", upi });
        expect(req.status).toBe(200);
        // one-UPI-per-worker is postponed: another worker may use the same ID
        expect((await other.post("/api/payouts", { amountPaise: "3000", upi })).status).toBe(200);
        // the payer refuses it
        expect((await owner.post(`/api/admin/payouts/${req.body.id}/reject`, { reason: "x" })).status).toBe(400);
        expect((await owner.post(`/api/admin/payouts/${req.body.id}/reject`, { reason: "UPI ID is invalid. Check it and try again." })).status).toBe(200);
        const mine = (await worker.get("/api/wallet")).body.payouts[0];
        expect(mine).toMatchObject({ status: "rejected", rejectReason: "UPI ID is invalid. Check it and try again." });
        expect((await owner.post(`/api/admin/payouts/${req.body.id}/reject`, { reason: "again please" })).body.error.code).toBe("not_pending");
        expect((await worker.post("/api/payouts", { amountPaise: "3000", upi })).status).toBe(200); // the amount is free again
        // a non-admin cannot reject
        expect((await worker.post(`/api/admin/payouts/${req.body.id}/reject`, { reason: "nope nope" })).status).toBe(403);
      });

      it("changing the password over HTTP: wrong current is a 400 (the app stays signed in), other browsers are signed out", async () => {
        const one = browser(api, "10.4.0.1"); const s = await signUp(one, "Pari");
        const two = browser(api, "10.4.0.2");
        expect((await two.post("/api/auth/sign-in", { email: s.email, password: "correct horse 1" })).status).toBe(200);
        expect((await two.get("/api/me")).status).toBe(200);
        const wrong = await one.post("/api/me/password", { current: "nope nope nope", next: "another pass 123" });
        expect(wrong.status).toBe(400);
        expect(wrong.body.error.code).toBe("invalid_credentials");
        expect((await one.get("/api/me")).status).toBe(200);
        expect((await one.post("/api/me/password", { current: "correct horse 1", next: "another pass 123" })).status).toBe(200);
        expect((await one.get("/api/me")).status).toBe(200);
        expect((await two.get("/api/me")).status).toBe(401);
        expect((await browser(api, "10.4.0.3").post("/api/me/password", { current: "x", next: "y" })).status).toBe(401);
      });

      it("every visit renews the session cookie for another week", async () => {
        const b = browser(api, "10.3.1.1"); await signUp(b, "Nila");
        const first = await b.get("/api/me");
        expect(first.headers.get("set-cookie")).toBeNull(); // too soon after sign-in: nothing to renew
        ctx.clock.advance(10 * 60_000);
        const later = await b.get("/api/me");
        expect(later.headers.get("set-cookie")).toMatch(/Max-Age=604[0-9]{3}/); // 168 hours = 604800 seconds
        expect(later.headers.get("set-cookie")).toContain("HttpOnly");
      });

      it("support ticket round trip", async () => {
        const owner = browser(api, "10.2.0.1"); const o = await signUp(owner, "Sneha"); await makeAdminFor(o.email, "all");
        const worker = browser(api, "10.2.0.2"); await signUp(worker, "Priya S.");
        const t = await worker.post("/api/tickets", { title: "Slow payout", body: "It has been three days." });
        expect(t.status).toBe(200);
        const open = (await owner.get("/api/admin/tickets")).body.find((x: any) => x.id === t.body.id);
        expect(open).toMatchObject({ needsReply: true, messages: [] });
        const agents = (await owner.get("/api/admin/ticket-agents")).body;
        const adminId = (await owner.get("/api/admin/me")).body.userId;
        expect(agents.map((a: any) => a.id)).toContain(adminId);
        expect((await owner.post(`/api/admin/tickets/${t.body.id}/assign`, { assigneeId: adminId })).body.assignee).toBe("Sneha");
        expect((await owner.post(`/api/admin/tickets/${t.body.id}/reply`, { body: "On it." })).body.messages.at(-1).sender).toBe("admin");
        expect((await worker.post(`/api/tickets/${t.body.id}/messages`, { body: "Thanks" })).status).toBe(200);
        expect((await owner.post(`/api/admin/tickets/${t.body.id}/resolve`)).body.status).toBe("closed");
        expect((await worker.post(`/api/tickets/${t.body.id}/messages`, { body: "one more" })).body.error.code).toBe("ticket_closed");
        expect((await worker.get(`/api/tickets/${t.body.id}`)).body.messages.length).toBeGreaterThan(3);
      });

      it("adding an extra email and switching which one claims", async () => {
        const worker = browser(api, "10.3.0.1"); await signUp(worker);
        const alt = `alt${Date.now()}@example.com`;
        expect((await worker.post("/api/identities/send-code", { email: alt })).status).toBe(200);
        expect((await worker.post("/api/identities", { email: alt, code: "000000" })).body.error.code).toBe("invalid_code");
        const added = await worker.post("/api/identities", { email: alt, code: lastCode() });
        expect(added.body).toMatchObject({ email: alt, isPrimary: false });
        expect((await worker.get("/api/me")).body.identities).toHaveLength(2);
      });

      it("forgot password end to end signs the worker in and the old password stops working", async () => {
        const b = browser(api, "10.4.0.1"); const { email } = await signUp(b);
        await b.post("/api/auth/sign-out");
        ctx.clock.advance(31_000);
        await b.post("/api/auth/request-code", { email, purpose: "reset" });
        const v = await b.post("/api/auth/verify-code", { email, code: lastCode(), purpose: "reset" });
        expect((await b.post("/api/auth/reset-password", { ticket: v.body.ticket, password: "a whole new one 7" })).status).toBe(200);
        expect((await b.get("/api/me")).status).toBe(200);
        b.forgetCookie();
        expect((await b.post("/api/auth/sign-in", { email, password: "correct horse 1" })).status).toBe(401);
        expect((await b.post("/api/auth/sign-in", { email, password: "a whole new one 7" })).status).toBe(200);
      });
    });

    it("a suspended worker's next request is refused even with a valid cookie", async () => {
      const b = browser(api, "10.5.0.1"); const { email } = await signUp(b);
      expect((await b.get("/api/me")).status).toBe(200);
      await ctx.db.query("update users set status = 'suspended' where id = (select user_id from identities where lower(email) = $1)", [email]);
      expect((await b.get("/api/me")).status).toBe(401);
    });
  });
}
