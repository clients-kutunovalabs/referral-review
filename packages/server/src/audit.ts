import type { Queryable } from "@rr/db";
import type { Ctx } from "./ctx";

/** Every admin action is written here, in the same transaction as the action. actor is null for system work. */
export async function audit(q: Queryable, ctx: Ctx, actorUserId: string | null, action: string, target?: { type: string; id: string }, detail: Record<string, unknown> = {}): Promise<void> {
  await q.query(
    "insert into admin_audit_log (workspace_id, actor_user_id, action, target_type, target_id, detail, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [ctx.cfg.workspaceId, actorUserId, action, target?.type ?? null, target?.id ?? null, JSON.stringify(detail, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), ctx.now()]
  );
}
