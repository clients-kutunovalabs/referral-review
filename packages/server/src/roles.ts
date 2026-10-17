import { PERMISSIONS, type AdminMember, type PermissionKey, type Role } from "@rr/core";
import { OWNER_ROLE_ID, isUniqueViolation } from "@rr/db";
import { audit } from "./audit";
import { isEmail, normaliseEmail } from "./auth";
import type { Ctx } from "./ctx";
import { conflict, fail, forbidden, notFound } from "./errors";
import { needs, type AdminActor } from "./rbac";

const VALID = new Set<string>(PERMISSIONS.map((p) => p.key));

/** Any admin may see the role list (their own profile page names their roles); only role managers can change it. */
export async function listRoles(ctx: Ctx): Promise<Role[]> {
  const roles = await ctx.db.query<{ id: string; name: string; is_owner: boolean }>("select id, name, is_owner from roles where workspace_id = $1 order by is_owner desc, created_at", [ctx.cfg.workspaceId]);
  const perms = await ctx.db.query<{ role_id: string; permission: PermissionKey }>("select rp.role_id, rp.permission from role_permissions rp join roles r on r.id = rp.role_id where r.workspace_id = $1", [ctx.cfg.workspaceId]);
  return roles.map((r) => ({ id: r.id, name: r.name, permissions: perms.filter((p) => p.role_id === r.id).map((p) => p.permission) }));
}

export async function createRole(ctx: Ctx, actor: AdminActor, rawName: string): Promise<Role> {
  needs(actor, "role.manage");
  const name = rawName.trim();
  if (!name) fail("bad_request", "Give the role a name.");
  if (name.length > 60) fail("bad_request", "That role name is too long.");
  try {
    return await ctx.db.tx(async (t) => {
      const [r] = await t.query<{ id: string }>("insert into roles (workspace_id, name, created_at) values ($1,$2,$3) returning id", [ctx.cfg.workspaceId, name, ctx.now()]);
      await audit(t, ctx, actor.userId, "role.create", { type: "role", id: r!.id }, { name });
      return { id: r!.id, name, permissions: [] };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return conflict("conflict", "A role with that name already exists.");
    throw err;
  }
}

async function editableRole(ctx: Ctx, t: { query: Ctx["db"]["query"] }, roleId: string): Promise<void> {
  const [r] = await t.query<{ is_owner: boolean }>("select is_owner from roles where id = $1 and workspace_id = $2 for update", [roleId, ctx.cfg.workspaceId]);
  if (!r) return notFound("Role");
  if (r.is_owner) return forbidden("The Owner role cannot be edited or deleted.");
}

export async function setRolePermissions(ctx: Ctx, actor: AdminActor, roleId: string, permissions: PermissionKey[]): Promise<void> {
  needs(actor, "role.manage");
  if (permissions.some((p) => !VALID.has(p))) fail("bad_request", "Unknown permission.");
  await ctx.db.tx(async (t) => {
    await editableRole(ctx, t, roleId);
    await t.query("delete from role_permissions where role_id = $1", [roleId]);
    for (const p of new Set(permissions)) await t.query("insert into role_permissions (role_id, permission) values ($1,$2)", [roleId, p]);
    await audit(t, ctx, actor.userId, "role.set_permissions", { type: "role", id: roleId }, { permissions });
  });
}

export async function deleteRole(ctx: Ctx, actor: AdminActor, roleId: string): Promise<void> {
  needs(actor, "role.manage");
  await ctx.db.tx(async (t) => {
    await editableRole(ctx, t, roleId);
    await t.query("delete from roles where id = $1", [roleId]);
    await audit(t, ctx, actor.userId, "role.delete", { type: "role", id: roleId });
  });
}

export async function listMembers(ctx: Ctx, actor: AdminActor): Promise<AdminMember[]> {
  needs(actor, "role.manage", "user.manage");
  const members = await ctx.db.query<{ user_id: string; name: string; is_owner: boolean }>(
    "select m.user_id, u.name, m.is_owner from admin_members m join users u on u.id = m.user_id where m.workspace_id = $1 order by m.is_owner desc, m.created_at", [ctx.cfg.workspaceId]);
  const links = await ctx.db.query<{ user_id: string; role_id: string }>("select mr.user_id, mr.role_id from member_roles mr join admin_members m on m.user_id = mr.user_id where m.workspace_id = $1", [ctx.cfg.workspaceId]);
  return members.map((m) => ({
    id: m.user_id, name: m.is_owner ? `${m.name} (owner)` : m.name, isOwner: m.is_owner,
    roleIds: m.is_owner ? [OWNER_ROLE_ID] : links.filter((l) => l.user_id === m.user_id).map((l) => l.role_id)
  }));
}

/** Makes an existing, active account a team member (with no roles yet). The person signs up normally first. */
export async function addMember(ctx: Ctx, actor: AdminActor, rawEmail: string): Promise<AdminMember> {
  needs(actor, "role.manage");
  const email = normaliseEmail(rawEmail);
  if (!isEmail(email)) fail("invalid_email", "Enter a valid email address.");
  return ctx.db.tx(async (t) => {
    const [u] = await t.query<{ id: string; name: string; status: string }>(
      "select u.id, u.name, u.status from identities i join users u on u.id = i.user_id where i.workspace_id = $1 and lower(i.email) = $2 and i.is_primary", [ctx.cfg.workspaceId, email]);
    if (!u) return fail("not_found", "No account uses that main email. Ask them to sign up first.", 404);
    if (u.status !== "active") return fail("bad_request", "That account is not active.");
    const rows = await t.query("insert into admin_members (user_id, workspace_id) values ($1,$2) on conflict do nothing returning user_id", [u.id, ctx.cfg.workspaceId]);
    if (!rows.length) return conflict("conflict", "That person is already on the team.");
    await audit(t, ctx, actor.userId, "member.add", { type: "user", id: u.id });
    return { id: u.id, name: u.name, isOwner: false, roleIds: [] };
  });
}

export async function setMemberRoles(ctx: Ctx, actor: AdminActor, userId: string, roleIds: string[]): Promise<void> {
  needs(actor, "role.manage");
  await ctx.db.tx(async (t) => {
    const [m] = await t.query<{ is_owner: boolean }>("select is_owner from admin_members where user_id = $1 and workspace_id = $2 for update", [userId, ctx.cfg.workspaceId]);
    if (!m) return notFound("Team member");
    if (m.is_owner) return forbidden("The owner's roles cannot be changed.");
    const valid = await t.query<{ id: string }>("select id from roles where workspace_id = $1 and not is_owner and id = any($2::uuid[])", [ctx.cfg.workspaceId, roleIds]);
    if (valid.length !== new Set(roleIds).size) return fail("bad_request", "One of those roles does not exist.");
    await t.query("delete from member_roles where user_id = $1", [userId]);
    for (const r of valid) await t.query("insert into member_roles (user_id, role_id) values ($1,$2)", [userId, r.id]);
    await audit(t, ctx, actor.userId, "member.set_roles", { type: "user", id: userId }, { roleIds: valid.map((r) => r.id) });
  });
}
