import { OWNER_ROLE_ID } from "@rr/db";
import { audit } from "./audit";
import type { Ctx } from "./ctx";
import { hashPassword } from "./crypto";
import { isEmail, normaliseEmail } from "./auth";
import { fail } from "./errors";

/**
 * Makes sure the owner account exists with every permission. Safe to run on every start: it only creates what is missing
 * and never changes an existing password. The owner is the first admin; everyone else is added from the Team screen.
 */
export async function seedOwner(ctx: Ctx, owner: { email: string; name: string; password: string }): Promise<"created" | "existing"> {
  const email = normaliseEmail(owner.email);
  if (!isEmail(email)) return fail("invalid_email", "OWNER_EMAIL is not a valid email address.");
  const hash = await hashPassword(owner.password);
  return ctx.db.tx(async (t) => {
    const [existing] = await t.query<{ user_id: string }>("select user_id from identities where workspace_id = $1 and lower(email) = $2 and is_primary and released_at is null", [ctx.cfg.workspaceId, email]);
    let userId = existing?.user_id;
    let created = false;
    if (!userId) {
      const [u] = await t.query<{ id: string }>("insert into users (workspace_id, name, created_at) values ($1,$2,$3) returning id", [ctx.cfg.workspaceId, owner.name, ctx.now()]);
      userId = u!.id;
      await t.query("insert into identities (workspace_id, user_id, email, is_primary, verified_at, created_at) values ($1,$2,$3,true,$4,$4)", [ctx.cfg.workspaceId, userId, email, ctx.now()]);
      await t.query("insert into auth_credentials (user_id, password_hash, updated_at) values ($1,$2,$3)", [userId, hash, ctx.now()]);
      created = true;
    }
    const [anyOwner] = await t.query<{ user_id: string }>("select user_id from admin_members where workspace_id = $1 and is_owner", [ctx.cfg.workspaceId]);
    if (!anyOwner) {
      await t.query("insert into admin_members (user_id, workspace_id, is_owner) values ($1,$2,true) on conflict (user_id) do update set is_owner = true", [userId, ctx.cfg.workspaceId]);
      await t.query("insert into member_roles (user_id, role_id) values ($1,$2) on conflict do nothing", [userId, OWNER_ROLE_ID]);
      await audit(t, ctx, null, "owner.seed", { type: "user", id: userId });
    }
    return created ? "created" : "existing";
  });
}
