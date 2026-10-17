import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations.generated";
import { migrate } from "./migrate";
import { createTestDb, engines } from "./testing";
import { DEFAULT_WORKSPACE_ID, OWNER_ROLE_ID, isUniqueViolation, pgCode } from "./index";

it("generated migrations match migrations/*.sql (run `pnpm --filter @rr/db embed` if this fails)", () => {
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  expect(MIGRATIONS.map((m) => m.id)).toEqual(files.map((f) => f.replace(/\.sql$/, "")));
  for (const f of files) expect(MIGRATIONS.find((m) => m.id === f.replace(/\.sql$/, ""))!.sql).toBe(readFileSync(new URL(f, dir), "utf8"));
});

for (const engine of engines()) {
  describe(`schema on ${engine}`, () => {
    const setup = () => createTestDb(engine);
    const WS = DEFAULT_WORKSPACE_ID;

    async function user(db: Awaited<ReturnType<typeof setup>>["db"], name = "U") {
      const [u] = await db.query<{ id: string }>("insert into users (workspace_id, name) values ($1, $2) returning id", [WS, name]);
      const [i] = await db.query<{ id: string }>("insert into identities (workspace_id, user_id, email, is_primary) values ($1, $2, $3, true) returning id", [WS, u!.id, `${name}@x.co`]);
      return { userId: u!.id, identityId: i!.id };
    }
    async function submission(db: Awaited<ReturnType<typeof setup>>["db"], u: { userId: string; identityId: string }) {
      const [t] = await db.query<{ id: string }>("insert into task_templates (workspace_id, title, description, site_url, reward_paise) values ($1,'t','d','https://x.co',4000) returning id", [WS]);
      const [c] = await db.query<{ id: string }>("insert into task_claims (workspace_id, template_id, user_id, identity_id, reward_paise) values ($1,$2,$3,$4,4000) returning id", [WS, t!.id, u.userId, u.identityId]);
      const [f] = await db.query<{ id: string }>("insert into files (workspace_id, owner_user_id, kind, storage_key, content_type, size_bytes) values ($1,$2,'proof',$3,'image/png',10) returning id", [WS, u.userId, `k-${Math.random()}`]);
      const [s] = await db.query<{ id: string }>("insert into submissions (workspace_id, claim_id, file_id) values ($1,$2,$3) returning id", [WS, c!.id, f!.id]);
      return s!.id;
    }
    const credit = (db: Awaited<ReturnType<typeof setup>>["db"], u: { userId: string; identityId: string }, sub: string, amt: bigint) =>
      db.query("insert into wallet_transactions (workspace_id, user_id, identity_id, kind, amount_paise, submission_id) values ($1,$2,$3,'credit',$4,$5)", [WS, u.userId, u.identityId, amt, sub]);

    it("migrates once and is idempotent; seeds the workspace and owner role", async () => {
      const { db, close } = await setup();
      expect(await migrate(db)).toEqual([]);
      expect((await db.query("select id from workspaces"))[0]).toEqual({ id: WS });
      expect((await db.query<{ n: number }>("select count(*)::int as n from role_permissions where role_id = $1", [OWNER_ROLE_ID]))[0]!.n).toBe(9);
      await close();
    });

    it("returns bigint columns as bigint", async () => {
      const { db, close } = await setup();
      const [r] = await db.query<{ v: bigint }>("select 9007199254740993::bigint as v");
      expect(r!.v).toBe(9007199254740993n);
      const [b] = await db.query<{ v: bigint }>("select $1::bigint + 1 as v", [9007199254740992n]);
      expect(b!.v).toBe(9007199254740993n);
      await close();
    });

    it("the ledger cannot be edited, deleted or truncated", async () => {
      const { db, close } = await setup();
      const u = await user(db); const s = await submission(db, u);
      await credit(db, u, s, 4000n);
      await expect(db.query("update wallet_transactions set amount_paise = 1")).rejects.toThrow(/append-only/);
      await expect(db.query("delete from wallet_transactions")).rejects.toThrow(/append-only/);
      await expect(db.exec("truncate wallet_transactions")).rejects.toThrow(/append-only/);
      await close();
    });

    it("audit log and reviews are append-only too", async () => {
      const { db, close } = await setup();
      await db.query("insert into admin_audit_log (workspace_id, action) values ($1, 'x')", [WS]);
      await expect(db.query("update admin_audit_log set action = 'y'")).rejects.toThrow(/append-only/);
      await expect(db.query("delete from admin_audit_log")).rejects.toThrow(/append-only/);
      await close();
    });

    it("allows one credit per submission", async () => {
      const { db, close } = await setup();
      const u = await user(db); const s = await submission(db, u);
      await credit(db, u, s, 1000n);
      const err = await credit(db, u, s, 1000n).then(() => null, (e: unknown) => e);
      expect(isUniqueViolation(err)).toBe(true);
      await close();
    });

    it("refuses a debit larger than the balance, and accepts one within it", async () => {
      const { db, close } = await setup();
      const u = await user(db); const s = await submission(db, u);
      await credit(db, u, s, 5000n);
      const pay = async (amt: bigint) => {
        const [p] = await db.query<{ id: string }>("insert into payout_requests (workspace_id, user_id, amount_paise, upi_encrypted, upi_masked) values ($1,$2,$3,'x','x') returning id", [WS, u.userId, amt]);
        return db.query("insert into wallet_transactions (workspace_id, user_id, identity_id, kind, amount_paise, payout_request_id) values ($1,$2,$3,'debit',$4,$5)", [WS, u.userId, u.identityId, amt, p!.id]);
      };
      const tooMuch = await db.tx(async (t) => {
        const [p] = await t.query<{ id: string }>("insert into payout_requests (workspace_id, user_id, amount_paise, upi_encrypted, upi_masked) values ($1,$2,6000,'x','x') returning id", [WS, u.userId]);
        await t.query("insert into wallet_transactions (workspace_id, user_id, identity_id, kind, amount_paise, payout_request_id) values ($1,$2,$3,'debit',6000,$4)", [WS, u.userId, u.identityId, p!.id]);
      }).then(() => null, (e: unknown) => e);
      expect(pgCode(tooMuch)).toBe("23514");
      await pay(5000n);
      await close();
    });

    it("allows one pending payout per user", async () => {
      const { db, close } = await setup();
      const u = await user(db);
      const ins = () => db.query("insert into payout_requests (workspace_id, user_id, amount_paise, upi_encrypted, upi_masked) values ($1,$2,1000,'x','x')", [WS, u.userId]);
      await ins();
      expect(isUniqueViolation(await ins().then(() => null, (e: unknown) => e))).toBe(true);
      await close();
    });

    it("one live claim per email and task, but an expired claim frees the slot", async () => {
      const { db, close } = await setup();
      const u = await user(db);
      const [t] = await db.query<{ id: string }>("insert into task_templates (workspace_id, title, description, site_url, reward_paise) values ($1,'t','d','https://x.co',4000) returning id", [WS]);
      const claim = (status = "claimed") => db.query("insert into task_claims (workspace_id, template_id, user_id, identity_id, reward_paise, status) values ($1,$2,$3,$4,4000,$5)", [WS, t!.id, u.userId, u.identityId, status]);
      await claim();
      expect(isUniqueViolation(await claim().then(() => null, (e: unknown) => e))).toBe(true);
      await db.query("update task_claims set status = 'expired'");
      await claim();
      await close();
    });

    it("financial rows cannot be orphaned by deleting a user", async () => {
      const { db, close } = await setup();
      const u = await user(db); const s = await submission(db, u);
      await credit(db, u, s, 1000n);
      await expect(db.query("delete from users where id = $1", [u.userId])).rejects.toThrow();
      await close();
    });
  });
}
