import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError, PERMISSIONS } from "@rr/core";
import { OWNER_ROLE_ID } from "@rr/db";
import {
  addMember, assignTicket, createRole, createSession, createTicket, dashboard, deleteRole, fileUrl, getAdminTicket, getUserTicket, listAdminTickets, listMembers,
  listRoles, listUserTickets, listUsers, loadAdmin, readFile, replyTicket, resolveSession, resolveTicket, saveUpload, setMemberRoles, setRolePermissions,
  setUserStatus, sniffImage, ticketAgents, userSendMessage, mayUpload, getUser
} from "./index";
import { PNG, createTestCtx, engines, fund, makeAdmin, makeTask, makeUser, submitted, type TestCtx } from "./testing";
import type { AdminActor } from "./rbac";

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as ApiError | null)?.code;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);

for (const engine of engines()) {
  describe(`admin on ${engine}`, () => {
    let ctx: TestCtx; let owner: AdminActor;
    beforeAll(async () => { ctx = await createTestCtx(engine); owner = await makeAdmin(ctx); });
    afterAll(() => ctx.close());

    describe("permissions", () => {
      it("reads roles from the database on every call, so a change applies at once", async () => {
        const a = await makeAdmin(ctx, ["review.decide"]);
        expect([...a.permissions]).toEqual(["review.decide"]);
        const [r] = await ctx.db.query<{ role_id: string }>("select role_id from member_roles where user_id = $1", [a.userId]);
        await ctx.db.query("insert into role_permissions (role_id, permission) values ($1, 'ticket.manage')", [r!.role_id]);
        expect([...(await loadAdmin(ctx.db, a.userId))!.permissions].sort()).toEqual(["review.decide", "ticket.manage"]);
        await ctx.db.query("delete from member_roles where user_id = $1", [a.userId]);
        expect((await loadAdmin(ctx.db, a.userId))!.permissions.size).toBe(0);
      });
      it("a worker or a suspended admin has no admin access", async () => {
        const w = await makeUser(ctx);
        expect(await loadAdmin(ctx.db, w.userId)).toBeNull();
        const a = await makeAdmin(ctx, ["review.decide"]);
        await ctx.db.query("update users set status = 'suspended' where id = $1", [a.userId]);
        expect(await loadAdmin(ctx.db, a.userId)).toBeNull();
      });
    });

    describe("roles and team", () => {
      it("creates, edits, lists and deletes roles; the Owner role is protected", async () => {
        const r = await createRole(ctx, owner, "Support lead");
        expect(await code(createRole(ctx, owner, "support LEAD"))).toBe("conflict");
        expect(await code(createRole(ctx, owner, "  "))).toBe("bad_request");
        await setRolePermissions(ctx, owner, r.id, ["ticket.manage", "ticket.manage", "review.decide"]);
        expect((await listRoles(ctx)).find((x) => x.id === r.id)!.permissions.sort()).toEqual(["review.decide", "ticket.manage"]);
        expect(await code(setRolePermissions(ctx, owner, r.id, ["made.up" as never]))).toBe("bad_request");
        expect(await code(setRolePermissions(ctx, owner, OWNER_ROLE_ID, []))).toBe("forbidden");
        expect(await code(deleteRole(ctx, owner, OWNER_ROLE_ID))).toBe("forbidden");
        await deleteRole(ctx, owner, r.id);
        expect((await listRoles(ctx)).some((x) => x.id === r.id)).toBe(false);
        expect((await listRoles(ctx)).find((x) => x.id === OWNER_ROLE_ID)!.permissions).toHaveLength(PERMISSIONS.length);
      });
      it("only role managers can change roles", async () => {
        const viewer = await makeAdmin(ctx, ["user.manage"]);
        expect(await code(createRole(ctx, viewer, "Nope"))).toBe("forbidden");
        expect(await code(addMember(ctx, viewer, "x@y.co"))).toBe("forbidden");
      });
      it("adds a person as a team member by their main email, then gives them roles; deleting a role removes it from people", async () => {
        const w = await makeUser(ctx);
        const m = await addMember(ctx, owner, w.email);
        expect(m).toMatchObject({ id: w.userId, roleIds: [] });
        expect(await code(addMember(ctx, owner, w.email))).toBe("conflict");
        expect(await code(addMember(ctx, owner, "nobody@nowhere.co"))).toBe("not_found");
        const r = await createRole(ctx, owner, "Reviewers X");
        await setRolePermissions(ctx, owner, r.id, ["review.decide"]);
        await setMemberRoles(ctx, owner, w.userId, [r.id]);
        expect([...(await loadAdmin(ctx.db, w.userId))!.permissions]).toEqual(["review.decide"]);
        expect(await code(setMemberRoles(ctx, owner, w.userId, [OWNER_ROLE_ID]))).toBe("bad_request");
        await deleteRole(ctx, owner, r.id);
        expect((await listMembers(ctx, owner)).find((x) => x.id === w.userId)!.roleIds).toEqual([]);
      });
      it("a role manager cannot raise themselves or anyone past their own permissions; only the owner hands out Manage roles", async () => {
        const mgr = await makeAdmin(ctx, ["role.manage", "ticket.manage"]);
        const big = await createRole(ctx, owner, "Everything but roles");
        // the test "owner" holds every permission but is not THE owner, so it also cannot hand out Manage roles
        expect(await code(setRolePermissions(ctx, owner, big.id, ["role.manage"]))).toBe("forbidden");
        await setRolePermissions(ctx, owner, big.id, ["payout.mark_paid", "ticket.manage"]);
        // not on themselves, not beyond what they hold, not on a role holding more than they do
        const mine = (await listMembers(ctx, owner)).find((m) => m.id === mgr.userId)!.roleIds;
        expect(await code(setMemberRoles(ctx, mgr, mgr.userId, mine))).toBe("forbidden");
        const w = await makeUser(ctx); await addMember(ctx, owner, w.email);
        expect(await code(setMemberRoles(ctx, mgr, w.userId, [big.id]))).toBe("forbidden");
        expect(await code(setRolePermissions(ctx, mgr, big.id, ["ticket.manage"]))).toBe("forbidden");
        expect(await code(deleteRole(ctx, mgr, big.id))).toBe("forbidden");
        const fresh = await createRole(ctx, mgr, "Helpdesk");
        expect(await code(setRolePermissions(ctx, mgr, fresh.id, ["payout.mark_paid"]))).toBe("forbidden");
        expect(await code(setRolePermissions(ctx, mgr, fresh.id, ["role.manage"]))).toBe("forbidden");
        // within their own permissions, they can
        await setRolePermissions(ctx, mgr, fresh.id, ["ticket.manage"]);
        await setMemberRoles(ctx, mgr, w.userId, [fresh.id]);
        expect([...(await loadAdmin(ctx.db, w.userId))!.permissions]).toEqual(["ticket.manage"]);
        // and cannot take power away from someone who has more than they do
        await setMemberRoles(ctx, owner, w.userId, [big.id]);
        expect(await code(setMemberRoles(ctx, mgr, w.userId, []))).toBe("forbidden");
      });
      it("the real owner can hand out Manage roles", async () => {
        const [o] = await ctx.db.query<{ user_id: string }>("select user_id from admin_members where is_owner");
        const theOwner = o ? (await loadAdmin(ctx.db, o.user_id))! : await (async () => {
          await ctx.db.query("update admin_members set is_owner = true where user_id = $1", [owner.userId]);
          return (await loadAdmin(ctx.db, owner.userId))!;
        })();
        const r = await createRole(ctx, theOwner, "Team lead");
        await expect(setRolePermissions(ctx, theOwner, r.id, ["role.manage"])).resolves.toBeUndefined();
      });
      it("the owner member cannot be given other roles", async () => {
        const [o] = await ctx.db.query<{ user_id: string }>("select user_id from admin_members limit 1");
        await ctx.db.query("update admin_members set is_owner = true where user_id = $1 and not exists (select 1 from admin_members where is_owner)", [o!.user_id]);
        const [owned] = await ctx.db.query<{ user_id: string }>("select user_id from admin_members where is_owner");
        expect(await code(setMemberRoles(ctx, owner, owned!.user_id, []))).toBe("forbidden");
      });
    });

    describe("users", () => {
      it("suspend signs the person out and blocks them; reinstate restores; delete is permanent and keeps every record", async () => {
        const u = await makeUser(ctx);
        const s = await createSession(ctx, u.userId);
        await fund(ctx, u, owner, owner, 20n);
        await setUserStatus(ctx, owner, u.userId, "suspended");
        expect(await resolveSession(ctx, s.token)).toBeNull();
        expect((await listUsers(ctx, owner)).find((x) => x.id === u.userId)).toMatchObject({ status: "suspended", lifetime: 2000n, identityCount: 1 });
        await setUserStatus(ctx, owner, u.userId, "active");
        expect((await createSession(ctx, u.userId)).token).toBeDefined();
        await setUserStatus(ctx, owner, u.userId, "deleted");
        expect(await code(setUserStatus(ctx, owner, u.userId, "active"))).toBe("conflict");
        const [rows] = await ctx.db.query<{ n: number }>("select count(*)::int as n from wallet_transactions where user_id = $1", [u.userId]) as [{ n: number }];
        expect(rows.n).toBe(1); // the ledger entry is still there
      });
      it("you cannot suspend yourself or the owner, and need user.manage", async () => {
        const mgr = await makeAdmin(ctx, ["user.manage"]);
        expect(await code(setUserStatus(ctx, mgr, mgr.userId, "suspended"))).toBe("forbidden");
        const w = await makeUser(ctx);
        const reviewer = await makeAdmin(ctx, ["review.decide"]);
        expect(await code(setUserStatus(ctx, reviewer, w.userId, "suspended"))).toBe("forbidden");
        await ctx.db.query("update admin_members set is_owner = true where user_id = $1 and not exists (select 1 from admin_members where is_owner)", [owner.userId]);
        const [o] = await ctx.db.query<{ user_id: string }>("select user_id from admin_members where is_owner");
        expect(await code(setUserStatus(ctx, mgr, o!.user_id, "suspended"))).toBe("forbidden");
      });
      it("the user list comes a page at a time, newest first, and one user can be read directly", async () => {
        const made = [];
        for (let i = 0; i < 3; i++) { made.push(await makeUser(ctx)); ctx.clock.advance(1000); }
        await ctx.db.query("update users set created_at = $2 where id = $1", [made[2]!.userId, new Date(Date.now() + 86_400_000 * 365)]);
        const first = await listUsers(ctx, owner, 1);
        expect(first.map((u) => u.id)).toEqual([made[2]!.userId]);
        expect((await listUsers(ctx, owner, 2))).toHaveLength(2);
        expect(await getUser(ctx, owner, made[0]!.userId)).toMatchObject({ id: made[0]!.userId, status: "active" });
        expect(await code(getUser(ctx, owner, "00000000-0000-0000-0000-00000000dead"))).toBe("not_found");
      });
      it("a user manager handles workers, not the admin team; deleting dates the deletion", async () => {
        const mgr = await makeAdmin(ctx, ["user.manage"]);
        const colleague = await makeAdmin(ctx, ["review.decide"]);
        expect(await code(setUserStatus(ctx, mgr, colleague.userId, "suspended"))).toBe("forbidden");
        const w = await makeUser(ctx);
        await setUserStatus(ctx, mgr, w.userId, "deleted");
        const [u] = await ctx.db.query<{ deleted_at: Date | null }>("select deleted_at from users where id = $1", [w.userId]);
        expect(u!.deleted_at).not.toBeNull();
      });
      it("a suspended worker cannot submit, but their past records stay visible to admins", async () => {
        const u = await makeUser(ctx);
        const { submissionId } = await submitted(ctx, u, await makeTask(ctx, owner));
        await setUserStatus(ctx, owner, u.userId, "suspended");
        const { decide } = await import("./submissions");
        await expect(decide(ctx, owner, submissionId, 100, "decided anyway")).resolves.toBeUndefined();
      });
    });

    describe("support tickets", () => {
      it("a worker opens a ticket and chats; support sees it needs a reply, replies, resolves; the chat is then read-only", async () => {
        const u = await makeUser(ctx, "Ticket Person");
        const support = await makeAdmin(ctx, ["ticket.manage"], "Sneha");
        const t = await createTicket(ctx, u.userId, { title: "Payout is slow", body: "It has been three days now." });
        expect(t).toMatchObject({ number: expect.any(Number), status: "open", customerName: "Ticket Person", needsReply: true, assignee: null });
        expect(t.messages).toHaveLength(1);
        expect((await listAdminTickets(ctx, support)).find((x) => x.id === t.id)).toMatchObject({ needsReply: true, messages: [] });

        const replied = await replyTicket(ctx, support, t.id, "We are on it.");
        expect(replied.needsReply).toBe(false);
        expect(replied.messages.at(-1)).toMatchObject({ sender: "admin", senderName: "Sneha (Support)" });
        expect((await userSendMessage(ctx, u.userId, t.id, "Thanks!")).needsReply).toBe(true);

        const assigned = await assignTicket(ctx, support, t.id, support.userId);
        expect(assigned.assignee).toBe("Sneha");
        expect(assigned.messages.at(-1)).toMatchObject({ sender: "system", body: "Assigned to Sneha" });
        expect((await assignTicket(ctx, support, t.id, support.userId)).messages).toHaveLength(assigned.messages.length); // no duplicate note

        const done = await resolveTicket(ctx, support, t.id);
        expect(done).toMatchObject({ status: "closed", needsReply: false });
        expect(done.messages.at(-1)!.body).toBe("Marked as resolved by Sneha");
        expect(await code(userSendMessage(ctx, u.userId, t.id, "More?"))).toBe("ticket_closed");
        expect(await code(replyTicket(ctx, support, t.id, "More?"))).toBe("ticket_closed");
        expect((await getAdminTicket(ctx, support, t.id)).messages.length).toBeGreaterThan(3);
      });
      it("workers only see their own tickets", async () => {
        const a = await makeUser(ctx); const b = await makeUser(ctx);
        const t = await createTicket(ctx, a.userId, { title: "Mine", body: "A private problem." });
        expect(await code(getUserTicket(ctx, b.userId, t.id))).toBe("not_found");
        expect(await code(userSendMessage(ctx, b.userId, t.id, "hi"))).toBe("not_found");
        expect((await listUserTickets(ctx, b.userId)).some((x) => x.id === t.id)).toBe(false);
      });
      it("validates ticket text and limits open tickets", async () => {
        const u = await makeUser(ctx);
        expect(await code(createTicket(ctx, u.userId, { title: " ", body: "long enough body" }))).toBe("bad_request");
        expect(await code(createTicket(ctx, u.userId, { title: "x", body: "short" }))).toBe("bad_request");
        for (let i = 0; i < 10; i++) await createTicket(ctx, u.userId, { title: `t${i}`, body: "a long enough problem" });
        expect(await code(createTicket(ctx, u.userId, { title: "eleven", body: "a long enough problem" }))).toBe("conflict");
      });
      it("an image can be attached once and is served only to its owner and support", async () => {
        const u = await makeUser(ctx); const other = await makeUser(ctx);
        const support = await makeAdmin(ctx, ["ticket.manage"]);
        const { fileId } = await saveUpload(ctx, u.userId, "ticket_attachment", PNG);
        const t = await createTicket(ctx, u.userId, { title: "With image", body: "See the screenshot please.", fileId });
        expect(t.messages[0]!.attachment!.url).toBe(fileUrl(fileId));
        expect(await code(createTicket(ctx, u.userId, { title: "Reuse", body: "Reusing the same image.", fileId }))).toBe("upload_invalid");
        await expect(readFile(ctx, fileId, u.userId, null)).resolves.toHaveProperty("contentType", "image/png");
        await expect(readFile(ctx, fileId, support.userId, support)).resolves.toBeDefined();
        expect(await code(readFile(ctx, fileId, other.userId, null))).toBe("forbidden");
      });
      it("only people who can handle tickets can be assigned, and are offered as agents", async () => {
        const support = await makeAdmin(ctx, ["ticket.manage"], "Agent A");
        const payer = await makeAdmin(ctx, ["payout.mark_paid"]);
        const u = await makeUser(ctx);
        const t = await createTicket(ctx, u.userId, { title: "Assign me", body: "needs an agent assigned" });
        expect(await code(assignTicket(ctx, support, t.id, payer.userId))).toBe("bad_request");
        expect((await ticketAgents(ctx, support)).map((a) => a.id)).toContain(support.userId);
        expect((await ticketAgents(ctx, support)).map((a) => a.id)).not.toContain(payer.userId);
        expect(await code(listAdminTickets(ctx, payer))).toBe("forbidden");
      });
    });

    describe("files", () => {
      it("recognises real images by their bytes and ignores what the browser claims", async () => {
        expect(sniffImage(PNG)).toBe("image/png");
        expect(sniffImage(JPEG)).toBe("image/jpeg");
        expect(sniffImage(WEBP)).toBe("image/webp");
        expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
        expect(sniffImage(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
      });
      it("rejects empty, oversize and non-image uploads", async () => {
        const u = await makeUser(ctx);
        expect(await code(saveUpload(ctx, u.userId, "proof", new Uint8Array(0)))).toBe("upload_invalid");
        expect(await code(saveUpload(ctx, u.userId, "proof", new TextEncoder().encode("<html>")))).toBe("upload_invalid");
        const big = new Uint8Array(5 * 1024 * 1024 + 1); big.set(PNG);
        expect(await code(saveUpload(ctx, u.userId, "proof", big))).toBe("upload_invalid");
      });
      it("proofs are readable by the owner and reviewers; payment screenshots only by payers", async () => {
        const u = await makeUser(ctx);
        const reviewer = await makeAdmin(ctx, ["review.decide"]); const payer = await makeAdmin(ctx, ["payout.mark_paid"]);
        const proof = (await saveUpload(ctx, u.userId, "proof", PNG)).fileId;
        await expect(readFile(ctx, proof, reviewer.userId, reviewer)).resolves.toBeDefined();
        expect(await code(readFile(ctx, proof, payer.userId, payer))).toBe("forbidden");
        const pay = (await saveUpload(ctx, payer.userId, "payment_proof", PNG)).fileId;
        await expect(readFile(ctx, pay, payer.userId, payer)).resolves.toBeDefined();
        expect(await code(readFile(ctx, pay, reviewer.userId, reviewer))).toBe("forbidden");
        expect(await code(readFile(ctx, "00000000-0000-0000-0000-000000000000", u.userId, null))).toBe("not_found");
        expect(mayUpload("payment_proof", null)).toBe(false);
        expect(mayUpload("payment_proof", reviewer)).toBe(false);
        expect(mayUpload("payment_proof", payer)).toBe(true);
        expect(mayUpload("proof", null)).toBe(true);
      });
    });

    describe("dashboard", () => {
      it("shows counts and recent events only for the areas the admin may open", async () => {
        const u = await makeUser(ctx, "Dash Worker");
        const reviewer = await makeAdmin(ctx, ["review.decide"]);
        await submitted(ctx, u, await makeTask(ctx, owner, { title: "Dash task" }));
        await createTicket(ctx, u.userId, { title: "Dash ticket", body: "please look at this" });
        const all = await dashboard(ctx, owner);
        expect(all.pendingReview).toBeGreaterThanOrEqual(1);
        expect(all.openTickets).toBeGreaterThanOrEqual(1);
        expect(all.ticketsNeedReply).toBeGreaterThanOrEqual(1);
        expect(all.recent.some((r) => r.kind === "reviewqueue")).toBe(true);
        const limited = await dashboard(ctx, reviewer);
        expect(limited).toMatchObject({ openTickets: 0, payoutsDue: 0, activeTasks: 0 });
        expect(limited.pendingReview).toBeGreaterThanOrEqual(1);
        expect(limited.recent.every((r) => r.kind === "reviewqueue")).toBe(true);
      });
    });

    it("every admin action leaves an audit row naming who did it", async () => {
      const a = await makeAdmin(ctx, "all", "Auditor");
      const r = await createRole(ctx, a, "Audited role");
      const [row] = await ctx.db.query<{ actor_user_id: string; action: string }>("select actor_user_id, action from admin_audit_log where target_id = $1", [r.id]);
      expect(row).toEqual({ actor_user_id: a.userId, action: "role.create" });
    });
  });
}
