import type { AdminUserRow } from "@rr/core";
import { audit } from "./audit";
import type { Ctx } from "./ctx";
import { maskEmail } from "./crypto";
import { conflict, forbidden, notFound } from "./errors";
import { needs, type AdminActor } from "./rbac";
import { revokeUserSessions } from "./sessions";

export async function listUsers(ctx: Ctx, actor: AdminActor): Promise<AdminUserRow[]> {
  needs(actor, "user.manage");
  const rows = await ctx.db.query<{ id: string; name: string; email: string | null; status: AdminUserRow["status"]; lifetime: bigint; identity_count: number }>(
    `select u.id, u.name, status, (select i.email from identities i where i.user_id = u.id and i.is_primary) as email,
            coalesce((select sum(w.amount_paise) from wallet_transactions w where w.user_id = u.id and w.kind = 'credit'), 0)::bigint as lifetime,
            (select count(*) from identities i where i.user_id = u.id)::int as identity_count
     from users u where u.workspace_id = $1 order by u.created_at desc limit 500`, [ctx.cfg.workspaceId]);
  return rows.map((r) => ({ id: r.id, name: r.name, emailMasked: maskEmail(r.email ?? ""), status: r.status, lifetime: r.lifetime, identityCount: r.identity_count }));
}

/**
 * Suspend, reinstate or (softly) delete. Nothing is ever removed: claims, ledger, payouts and proofs stay for audit.
 * Suspended and deleted people are signed out and cannot log in, claim or ask for payouts. Delete cannot be undone.
 */
export async function setUserStatus(ctx: Ctx, actor: AdminActor, userId: string, status: "active" | "suspended" | "deleted"): Promise<void> {
  needs(actor, "user.manage");
  if (userId === actor.userId) return forbidden("You cannot change your own account.");
  await ctx.db.tx(async (t) => {
    const [u] = await t.query<{ status: string; is_admin: boolean }>(
      "select u.status, exists (select 1 from admin_members m where m.user_id = u.id and m.is_owner) as is_admin from users u where u.id = $1 and u.workspace_id = $2 for update", [userId, ctx.cfg.workspaceId]);
    if (!u) return notFound("User");
    if (u.is_admin) return forbidden("The owner account cannot be changed.");
    if (u.status === "deleted") return conflict("conflict", "A deleted account cannot be changed.");
    if (u.status === status) return;
    await t.query("update users set status = $2 where id = $1", [userId, status]);
    if (status !== "active") await revokeUserSessions(t, userId);
    if (status === "deleted") await t.query("delete from auth_credentials where user_id = $1", [userId]);
    await audit(t, ctx, actor.userId, `user.${status === "active" ? "reinstate" : status === "suspended" ? "suspend" : "delete"}`, { type: "user", id: userId });
  });
}
