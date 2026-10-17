import { PERMISSIONS, type PermissionKey } from "@rr/core";
import type { Queryable } from "@rr/db";
import { forbidden, fail } from "./errors";

export interface AdminActor {
  userId: string;
  name: string;
  isOwner: boolean;
  roleIds: string[];
  permissions: ReadonlySet<PermissionKey>;
}

const ALL = PERMISSIONS.map((p) => p.key);

/** Reads the admin's roles from the database. Called on every admin request: a role change takes effect immediately. */
export async function loadAdmin(q: Queryable, userId: string): Promise<AdminActor | null> {
  const [m] = await q.query<{ name: string; is_owner: boolean; status: string }>(
    "select u.name, m.is_owner, u.status from admin_members m join users u on u.id = m.user_id where m.user_id = $1", [userId]);
  if (!m || m.status !== "active") return null;
  const roles = await q.query<{ role_id: string }>("select role_id from member_roles where user_id = $1", [userId]);
  const perms = m.is_owner
    ? ALL
    : (await q.query<{ permission: PermissionKey }>(
        "select distinct rp.permission from member_roles mr join role_permissions rp on rp.role_id = mr.role_id where mr.user_id = $1", [userId])).map((r) => r.permission);
  return { userId, name: m.name, isOwner: m.is_owner, roleIds: roles.map((r) => r.role_id), permissions: new Set(perms) };
}

/** Passes when the admin holds at least one of the listed permissions. */
export function needs(actor: AdminActor, ...anyOf: PermissionKey[]): void {
  if (!anyOf.some((p) => actor.permissions.has(p))) forbidden();
}

export function assertAdmin(actor: AdminActor | null): AdminActor {
  if (!actor) return fail("forbidden", "Admin access required.", 403);
  return actor;
}
