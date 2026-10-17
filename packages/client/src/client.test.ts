import { describe, expect, it } from "vitest";
import { ApiError, AuthError, fixtures } from "@rr/core";
import { createHttp, createHttpAuth, createHttpApi, reviveMoney } from "./index";

const wire = (x: unknown) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

describe("money over the wire", () => {
  it("round-trips every shape the API returns, bigint in and bigint out", () => {
    for (const sample of [fixtures.tasks, fixtures.claims, fixtures.wallet, fixtures.identities, fixtures.userPayouts, fixtures.adminPayouts, fixtures.reviewQueue, fixtures.adminUsers]) {
      expect(reviveMoney(wire(sample))).toEqual(sample);
    }
  });
  it("leaves ordinary strings that look like numbers alone", () => {
    expect(reviveMoney({ title: "4000", reward: "4000", note: "12" })).toEqual({ title: "4000", reward: 4000n, note: "12" });
  });
});

function fake(handler: (req: { method: string; url: string; headers: Record<string, string>; body?: string }) => { status?: number; json?: unknown; headers?: Record<string, string> }) {
  const calls: { method: string; url: string; headers: Record<string, string>; body?: string }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const rec = { method: init.method ?? "GET", url, headers: (init.headers ?? {}) as Record<string, string>, ...(typeof init.body === "string" ? { body: init.body } : {}) };
    calls.push(rec);
    const r = handler(rec);
    return new Response(r.json === undefined ? "" : JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json", ...r.headers } });
  }) as typeof fetch;
  return { f, calls };
}

describe("http client", () => {
  it("fetches a CSRF token before the first write and sends it", async () => {
    const { f, calls } = fake((r) => (r.url === "/api/session" ? { json: { session: null, csrf: "tok123" } } : { json: { ok: true } }));
    const api = createHttpApi(createHttp({ fetch: f }));
    await api.user.requestPayout(2500n, "me@okbank");
    expect(calls.map((c) => c.url)).toEqual(["/api/session", "/api/payouts"]);
    expect(calls[1]!.headers["x-csrf-token"]).toBe("tok123");
    expect(calls[1]!.body).toBe(JSON.stringify({ amountPaise: "2500", upi: "me@okbank" })); // money as a string
  });
  it("refreshes the token and retries once when the server says csrf", async () => {
    let n = 0;
    const { f, calls } = fake((r) => {
      if (r.url === "/api/session") return { json: { csrf: `t${++n}` } };
      if (r.method === "GET") return { json: [] };
      return r.headers["x-csrf-token"] === "t2" ? { json: [] } : { status: 403, json: { error: { code: "csrf", message: "stale" } } };
    });
    const api = createHttpApi(createHttp({ fetch: f }));
    await expect(api.user.listTickets()).resolves.toEqual([]); // a GET needs none
    await expect(api.user.sendTicketMessage("id", "hi")).resolves.toEqual([]);
    expect(calls.filter((c) => c.url === "/api/session")).toHaveLength(2);
  });
  it("turns server errors into ApiError with the server's message and status", async () => {
    const { f } = fake(() => ({ status: 409, json: { error: { code: "slots_full", message: "All slots for this task are taken." } } }));
    const api = createHttpApi(createHttp({ fetch: f }));
    const err = await api.user.listTasks().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "slots_full", status: 409, message: "All slots for this task are taken." });
  });
  it("copes with a dead server or a non-JSON error page", async () => {
    const html = createHttpApi(createHttp({ fetch: (async () => new Response("<h1>Bad gateway</h1>", { status: 502 })) as typeof fetch }));
    expect(await html.user.listTasks().then(() => null, (e: unknown) => e)).toMatchObject({ code: "internal", status: 502 });
  });
  it("revives money in responses", async () => {
    const { f } = fake(() => ({ json: [{ id: "t", reward: "4000", slotsRemaining: 2 }] }));
    const tasks = await createHttpApi(createHttp({ fetch: f })).user.listTasks();
    expect(tasks[0]!.reward).toBe(4000n);
  });
  it("auth: sign-in stores the csrf token and surfaces typed AuthErrors", async () => {
    const { f, calls } = fake((r) => {
      if (r.url === "/api/auth/sign-in") return r.body!.includes("right") ? { json: { session: { user: { id: "u", email: "a@b.co", emailVerified: true, profile: {} }, expiresAt: "2030-01-01T00:00:00Z" }, csrf: "abc" } } : { status: 401, json: { error: { code: "invalid_credentials", message: "Email or password is incorrect." } } };
      return { json: { ok: true } };
    });
    const http = createHttp({ fetch: f });
    const auth = createHttpAuth(http);
    const bad = await auth.signIn("a@b.co", "wrong").then(() => null, (e: unknown) => e);
    expect(bad).toBeInstanceOf(AuthError);
    expect(bad).toMatchObject({ code: "invalid_credentials" });
    expect((await auth.signIn("a@b.co", "right")).user.email).toBe("a@b.co");
    await createHttpApi(http).user.sendTicketMessage("t", "x");
    expect(calls.at(-1)!.headers["x-csrf-token"]).toBe("abc");
  });
  it("auth: a network failure becomes a friendly AuthError", async () => {
    const auth = createHttpAuth(createHttp({ fetch: (async () => { throw new TypeError("network"); }) as typeof fetch }));
    expect(await auth.signIn("a@b.co", "x").then(() => null, (e: unknown) => e)).toMatchObject({ name: "AuthError", code: "internal" });
  });
});
