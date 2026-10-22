import type { DashboardView } from "@rr/core";
import { formatRupees } from "@rr/money";
import type { Ctx } from "./ctx";
import type { AdminActor } from "./rbac";
import { listAdminTasks } from "./tasks";

/** The admin home: only counts and events for the areas this admin may open. */
export async function dashboard(ctx: Ctx, actor: AdminActor): Promise<DashboardView> {
  const ws = ctx.cfg.workspaceId;
  const can = (p: Parameters<AdminActor["permissions"]["has"]>[0]) => actor.permissions.has(p);
  const recent: DashboardView["recent"] = [];
  let pendingReview = 0; let activeTasks = 0; let payoutsDue = 0; let openTickets = 0; let ticketsNeedReply = 0;

  if (can("review.decide")) {
    const [c] = await ctx.db.query<{ n: number }>("select count(*)::int as n from submissions where workspace_id = $1 and status = 'pending'", [ws]);
    pendingReview = c?.n ?? 0;
    const rows = await ctx.db.query<{ worker: string; title: string; at: Date }>(
      `select u.name as worker, t.title, s.submitted_at as at from submissions s join task_claims c on c.id = s.claim_id join users u on u.id = c.user_id
       join task_templates t on t.id = c.template_id where s.workspace_id = $1 and s.status = 'pending' order by s.submitted_at desc limit 3`, [ws]);
    for (const r of rows) recent.push({ kind: "reviewqueue", text: `${r.worker} submitted proof for "${r.title}"`, at: r.at.toISOString() });
  }
  if (can("task.manage") || can("task_text.manage")) {
    const open = await listAdminTasks(ctx, actor, { status: "active", limit: 1000 });
    activeTasks = open.filter((t) => t.status === "active" || t.status === "closing_soon").length;
    const closed = await listAdminTasks(ctx, actor, { status: "closed", limit: 20 });
    for (const t of closed.filter((x) => x.slotsTotal !== null && x.claimed >= x.slotsTotal).slice(0, 1)) {
      recent.push({ kind: "tasks", text: `"${t.title}" reached its slot limit`, at: ctx.now().toISOString() });
    }
  }
  if (can("payout.mark_paid")) {
    const [c] = await ctx.db.query<{ n: number }>("select count(*)::int as n from payout_requests where workspace_id = $1 and status = 'pending'", [ws]);
    payoutsDue = c?.n ?? 0;
    const rows = await ctx.db.query<{ name: string; amount_paise: bigint; at: Date }>(
      "select u.name, p.amount_paise, p.requested_at as at from payout_requests p join users u on u.id = p.user_id where p.workspace_id = $1 and p.status = 'pending' order by p.requested_at desc limit 3", [ws]);
    for (const r of rows) recent.push({ kind: "payouts", text: `${r.name} requested a payout of ${formatRupees(r.amount_paise)}`, at: r.at.toISOString() });
  }
  if (can("ticket.manage")) {
    const [c] = await ctx.db.query<{ open: number; waiting: number }>(
      `select count(*) filter (where status = 'open')::int as open,
              count(*) filter (where status = 'open' and coalesce((select m.sender_type = 'customer' from ticket_messages m where m.ticket_id = t.id and m.sender_type <> 'system' order by m.seq desc limit 1), false))::int as waiting
       from tickets t where workspace_id = $1`, [ws]);
    openTickets = c?.open ?? 0; ticketsNeedReply = c?.waiting ?? 0;
    const rows = await ctx.db.query<{ name: string; title: string; at: Date }>(
      "select u.name, t.title, t.created_at as at from tickets t join users u on u.id = t.user_id where t.workspace_id = $1 and t.status = 'open' order by t.created_at desc limit 3", [ws]);
    for (const r of rows) recent.push({ kind: "tickets", text: `${r.name} opened a ticket: "${r.title}"`, at: r.at.toISOString() });
  }
  recent.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { pendingReview, activeTasks, payoutsDue, openTickets, ticketsNeedReply, recent: recent.slice(0, 6) };
}
