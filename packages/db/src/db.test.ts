import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations.generated";
import { migrate } from "./migrate";
import { createBlankTestDb, createTestDb, engines } from "./testing";
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
      expect((await db.query<{ n: number }>("select count(*)::int as n from role_permissions where role_id = $1", [OWNER_ROLE_ID]))[0]!.n).toBe(7);
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

    it("one claim per email and task, ever: an expired or voided claim does not free the email", async () => {
      const { db, close } = await setup();
      const u = await user(db);
      const [t] = await db.query<{ id: string }>("insert into task_templates (workspace_id, title, description, site_url, reward_paise) values ($1,'t','d','https://x.co',4000) returning id", [WS]);
      const claim = (status = "claimed") => db.query("insert into task_claims (workspace_id, template_id, user_id, identity_id, reward_paise, status) values ($1,$2,$3,$4,4000,$5)", [WS, t!.id, u.userId, u.identityId, status]);
      await claim();
      expect(isUniqueViolation(await claim().then(() => null, (e: unknown) => e))).toBe(true);
      await db.query("update task_claims set status = 'expired'");
      expect(isUniqueViolation(await claim().then(() => null, (e: unknown) => e))).toBe(true);
      await close();
    });

    it("a released email (account deleted 30+ days ago) no longer blocks the address; a live one does", async () => {
      const { db, close } = await setup();
      const u = await user(db);
      const [{ email }] = await db.query<{ email: string }>("select email from identities where id = $1", [u.identityId]) as [{ email: string }];
      const again = () => db.query("insert into identities (workspace_id, user_id, email) values ($1,$2,$3)", [WS, u.userId, email.toUpperCase()]);
      expect(isUniqueViolation(await again().then(() => null, (e: unknown) => e))).toBe(true);
      await db.query("update identities set released_at = now() where id = $1", [u.identityId]);
      await again();
      await close();
    });

    it("a deleted account must carry its deletion time, and only a deleted one", async () => {
      const { db, close } = await setup();
      const u = await user(db);
      await expect(db.query("update users set status = 'deleted' where id = $1", [u.userId])).rejects.toThrow();
      await db.query("update users set status = 'deleted', deleted_at = now() where id = $1", [u.userId]);
      await expect(db.query("update users set deleted_at = null where id = $1", [u.userId])).rejects.toThrow();
      await close();
    });

    it("the removed permissions can no longer be granted", async () => {
      const { db, close } = await setup();
      await expect(db.query("insert into role_permissions (role_id, permission) values ($1, 'design.view')", [OWNER_ROLE_ID])).rejects.toThrow();
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

for (const engine of engines()) {
  describe(`upgrading an existing database on ${engine}`, () => {
    it("migration 0002 keeps existing payouts and the money records intact, and its rules apply to them", async () => {
      const { db, close } = await createBlankTestDb(engine);
      try {
        const [first, ...rest] = MIGRATIONS;
        // a site that launched on the first version: apply only it, as the real runner would have
        await db.tx(async (t) => {
          await t.exec("create table schema_migrations (id text primary key, applied_at timestamptz not null default now())");
          await t.exec(first!.sql);
          await t.query("insert into schema_migrations (id) values ($1)", [first!.id]);
        });
        const WS = DEFAULT_WORKSPACE_ID;
        const [u] = await db.query<{ id: string }>("insert into users (workspace_id, name) values ($1,'Old') returning id", [WS]);
        const [v] = await db.query<{ id: string }>("insert into users (workspace_id, name) values ($1,'Old2') returning id", [WS]);
        const payout = async (user: string, status: string, paidAt: string | null) => (await db.query<{ id: string }>(
          "insert into payout_requests (workspace_id, user_id, amount_paise, status, upi_encrypted, upi_masked, paid_at) values ($1,$2,2500,$3,'v1.x.y.z','pri••@okbank',$4) returning id", [WS, user, status, paidAt]))[0]!.id;
        const paid = await payout(u!.id, "paid", "2026-01-01T00:00:00Z");
        const pending = await payout(v!.id, "pending", null);

        const applied = await migrate(db);
        expect(applied).toEqual(rest.map((m) => m.id));

        // nothing was lost, and old rows simply have no UPI hash or rejection yet
        const rows = await db.query<{ id: string; status: string; amount_paise: bigint; upi_hash: string | null; reject_reason: string | null }>(
          "select id, status, amount_paise, upi_hash, reject_reason from payout_requests order by status");
        expect(rows.map((r) => [r.status, r.amount_paise, r.upi_hash, r.reject_reason])).toEqual([["paid", 2500n, null, null], ["pending", 2500n, null, null]]);

        // the new rules hold for them: a pending request can be rejected (with all three fields), a paid one cannot change
        await expect(db.query("update payout_requests set status = 'rejected' where id = $1", [pending])).rejects.toThrow(); // no reason recorded
        await db.query("update payout_requests set status = 'rejected', reject_reason = 'UPI ID is invalid', rejected_at = now(), rejected_by = $2 where id = $1", [pending, u!.id]);
        await expect(db.query("update payout_requests set status = 'pending' where id = $1", [pending])).rejects.toThrow();
        await expect(db.query("update payout_requests set status = 'rejected', reject_reason = 'x', rejected_at = now(), rejected_by = $2 where id = $1", [paid, u!.id])).rejects.toThrow();
        // running the migrations again changes nothing
        expect(await migrate(db)).toEqual([]);
      } finally { await close(); }
    });

    /** A database with only the first `n` migrations applied, as a site that launched on that version would have. */
    async function upTo(n: number) {
      const t = await createBlankTestDb(engine);
      await t.db.tx(async (q) => {
        await q.exec("create table schema_migrations (id text primary key, applied_at timestamptz not null default now())");
        for (const m of MIGRATIONS.slice(0, n)) { await q.exec(m.sql); await q.query("insert into schema_migrations (id) values ($1)", [m.id]); }
      });
      return t;
    }

    it("migration 0003 keeps deleted accounts' records, dates their deletion, and drops the removed permissions", async () => {
      const { db, close } = await upTo(2);
      try {
        const WS = DEFAULT_WORKSPACE_ID;
        const [u] = await db.query<{ id: string }>("insert into users (workspace_id, name, status) values ($1,'Gone','deleted') returning id", [WS]);
        await db.query("insert into identities (workspace_id, user_id, email, is_primary) values ($1,$2,'gone@x.co',true)", [WS, u!.id]);
        expect(await migrate(db)).toEqual(["0003_audit_fixes"]);
        const [row] = await db.query<{ deleted_at: Date | null; released_at: Date | null }>(
          "select u.deleted_at, i.released_at from users u join identities i on i.user_id = u.id where u.id = $1", [u!.id]);
        expect(row!.deleted_at).not.toBeNull(); // dated now, so the 30 days start at the upgrade
        expect(row!.released_at).toBeNull();
        const perms = (await db.query<{ permission: string }>("select permission from role_permissions where role_id = $1", [OWNER_ROLE_ID])).map((r) => r.permission);
        expect(perms).not.toContain("task.assign");
        expect(perms).not.toContain("design.view");
      } finally { await close(); }
    });

    it("migration 0003 stops, changing nothing, if an email already claimed the same task twice", async () => {
      const { db, close } = await upTo(2);
      try {
        const WS = DEFAULT_WORKSPACE_ID;
        const [u] = await db.query<{ id: string }>("insert into users (workspace_id, name) values ($1,'Twice') returning id", [WS]);
        const [i] = await db.query<{ id: string }>("insert into identities (workspace_id, user_id, email, is_primary) values ($1,$2,'twice@x.co',true) returning id", [WS, u!.id]);
        const [t] = await db.query<{ id: string }>("insert into task_templates (workspace_id, title, description, site_url, reward_paise) values ($1,'t','d','https://x.co',4000) returning id", [WS]);
        const claim = (status: string) => db.query("insert into task_claims (workspace_id, template_id, user_id, identity_id, reward_paise, status) values ($1,$2,$3,$4,4000,$5)", [WS, t!.id, u!.id, i!.id, status]);
        await claim("expired"); await claim("claimed");
        await expect(migrate(db)).rejects.toThrow(/claimed the same task more than once/);
        expect((await db.query<{ id: string }>("select id from schema_migrations")).map((r) => r.id)).not.toContain("0003_audit_fixes");
      } finally { await close(); }
    });
  });
}
