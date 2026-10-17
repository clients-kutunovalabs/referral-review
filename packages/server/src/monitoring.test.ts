import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recordHeartbeat, resetAlertThrottle, sendAlert, workerHealth, WORKER_STALE_SECONDS } from "./index";
import { createApi } from "./http/handler";
import { createTestCtx, engines, type TestCtx } from "./testing";

for (const engine of engines()) {
  describe(`monitoring on ${engine}`, () => {
    let ctx: TestCtx; let hook: Server; let received: { text: string }[] = [];
    beforeAll(async () => {
      ctx = await createTestCtx(engine);
      hook = createServer((req, res) => {
        let body = ""; req.on("data", (c) => { body += c; });
        req.on("end", () => { received.push(JSON.parse(body)); res.end("ok"); });
      });
      await new Promise<void>((r) => hook.listen(0, "127.0.0.1", r));
      ctx.cfg.alertWebhookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/`;
    });
    beforeEach(() => resetAlertThrottle());
    afterAll(async () => { hook.close(); await ctx.close(); });

    it("posts an alert to the webhook, holds back an identical one for five minutes, and names the site", async () => {
      received = [];
      await sendAlert(ctx, "Money records disagree.", "k-money");
      await sendAlert(ctx, "Money records disagree.", "k-money");
      await sendAlert(ctx, "A different problem.", "k-other");
      expect(received.map((m) => m.text)).toEqual(["[tasks.test] Money records disagree.", "[tasks.test] A different problem."]);
    });

    it("never throws, whatever is wrong with the webhook, and does nothing when none is set", async () => {
      const broken = { ...ctx, cfg: { ...ctx.cfg, alertWebhookUrl: "http://127.0.0.1:1/" } };
      await expect(sendAlert(broken, "nobody is listening", "k-broken")).resolves.toBeUndefined();
      const none = { ...ctx, cfg: { ...ctx.cfg, alertWebhookUrl: undefined } };
      await expect(sendAlert(none, "no url set", "k-none")).resolves.toBeUndefined();
    });

    it("the worker heartbeat goes never, then ok, then stale", async () => {
      expect(await workerHealth(ctx)).toEqual({ state: "never" });
      await recordHeartbeat(ctx);
      expect(await workerHealth(ctx)).toMatchObject({ state: "ok", ageSeconds: 0 });
      ctx.clock.advance((WORKER_STALE_SECONDS + 5) * 1000);
      expect(await workerHealth(ctx)).toMatchObject({ state: "stale" });
      await recordHeartbeat(ctx);
      expect(await workerHealth(ctx)).toMatchObject({ state: "ok" });
    });

    it("/api/health is 200 while the database answers; ?strict=1 is 503 once the worker has gone quiet", async () => {
      const api = createApi(ctx);
      const get = (q = "") => api(new Request(`https://tasks.test/api/health${q}`));
      await recordHeartbeat(ctx);
      expect((await get()).status).toBe(200);
      expect(await (await get("?strict=1")).json()).toMatchObject({ ok: true, worker: { state: "ok" } });
      ctx.clock.advance((WORKER_STALE_SECONDS + 5) * 1000);
      expect((await get()).status).toBe(200);
      const strict = await get("?strict=1");
      expect(strict.status).toBe(503);
      expect(await strict.json()).toMatchObject({ ok: false, worker: { state: "stale" } });
    });

    it("an unexpected server error returns a safe 500 and raises an alert without personal data", async () => {
      received = [];
      const failing = { ...ctx, db: { ...ctx.db, query: () => { throw new TypeError("secret detail: priya@gmail.com"); } } } as unknown as TestCtx;
      const res = await createApi(failing)(new Request("https://tasks.test/api/health"));
      expect(res.status).toBe(500);
      expect(JSON.stringify(await res.json())).not.toContain("priya");
      await new Promise((r) => setTimeout(r, 100));
      expect(received).toHaveLength(1);
      expect(received[0]!.text).toContain("Unexpected server error (TypeError)");
      expect(received[0]!.text).not.toContain("priya");
    });
  });
}
