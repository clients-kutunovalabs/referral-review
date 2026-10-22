import type { Ticket, TicketMessage } from "@rr/core";
import type { Queryable } from "@rr/db";
import { audit } from "./audit";
import type { Ctx } from "./ctx";
import { conflict, fail, notFound } from "./errors";
import { fileUrl } from "./files";
import { loadAdmin, needs, type AdminActor } from "./rbac";

interface TicketRow {
  id: string; number: number; title: string; status: "open" | "closed"; customer_name: string; customer_email: string | null;
  assignee_name: string | null; created_at: Date; updated_at: Date; resolved_at: Date | null; needs_reply: boolean;
}

const SELECT = `select t.id, t.number, t.title, t.status, u.name as customer_name,
  (select i.email from identities i where i.user_id = t.user_id and i.is_primary) as customer_email,
  a.name as assignee_name, t.created_at, t.updated_at, t.resolved_at,
  (t.status = 'open' and coalesce((select m.sender_type = 'customer' from ticket_messages m where m.ticket_id = t.id and m.sender_type <> 'system' order by m.seq desc limit 1), false)) as needs_reply
  from tickets t join users u on u.id = t.user_id left join users a on a.id = t.assignee_id`;

const toTicket = (r: TicketRow, messages: TicketMessage[] = []): Ticket => ({
  id: r.id, number: r.number, title: r.title, status: r.status, customerName: r.customer_name, customerEmail: r.customer_email ?? "",
  assignee: r.assignee_name, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  ...(r.resolved_at ? { resolvedAt: r.resolved_at.toISOString() } : {}), needsReply: r.needs_reply, messages
});

async function messagesOf(q: Queryable, ticketId: string): Promise<TicketMessage[]> {
  const rows = await q.query<{ id: string; sender_type: TicketMessage["sender"]; sender_name: string; body: string; created_at: Date; attachment_file_id: string | null }>(
    "select id, sender_type, sender_name, body, created_at, attachment_file_id from ticket_messages where ticket_id = $1 order by seq", [ticketId]);
  return rows.map((m) => ({
    id: m.id, sender: m.sender_type, senderName: m.sender_name, body: m.body, at: m.created_at.toISOString(),
    ...(m.attachment_file_id ? { attachment: { name: "attachment", url: fileUrl(m.attachment_file_id) as string } } : {})
  }));
}

async function full(ctx: Ctx, q: Queryable, id: string, ownerId?: string): Promise<Ticket> {
  const [r] = await q.query<TicketRow & { user_id: string }>(`${SELECT} where t.id = $1 and t.workspace_id = $2${ownerId ? " and t.user_id = $3" : ""}`, ownerId ? [id, ctx.cfg.workspaceId, ownerId] : [id, ctx.cfg.workspaceId]);
  if (!r) return notFound("Ticket");
  return toTicket(r, await messagesOf(q, id));
}

const BODY_MAX = 5000;

/* ---------- worker side ---------- */

export async function listUserTickets(ctx: Ctx, userId: string): Promise<Ticket[]> {
  const rows = await ctx.db.query<TicketRow>(`${SELECT} where t.user_id = $1 order by t.updated_at desc limit 200`, [userId]);
  return rows.map((r) => toTicket(r));
}
export const getUserTicket = (ctx: Ctx, userId: string, id: string): Promise<Ticket> => full(ctx, ctx.db, id, userId);

async function claimAttachment(t: Queryable, userId: string, fileId: string | null | undefined): Promise<string | null> {
  if (!fileId) return null;
  const [f] = await t.query<{ id: string }>("select f.id from files f where f.id = $1 and f.owner_user_id = $2 and f.kind = 'ticket_attachment' and not exists (select 1 from ticket_messages m where m.attachment_file_id = f.id)", [fileId, userId]);
  if (!f) return fail("upload_invalid", "That image could not be attached. Upload it again.");
  return f.id;
}

export async function createTicket(ctx: Ctx, userId: string, input: { title: string; body: string; fileId?: string | null }): Promise<Ticket> {
  const title = input.title.trim(); const body = input.body.trim();
  if (!title) fail("bad_request", "Give your ticket a short title.");
  if (title.length > 100) fail("bad_request", "The title is too long (max 100 characters).");
  if (body.length < 10) fail("bad_request", "Describe the problem in at least 10 characters.");
  if (body.length > BODY_MAX) fail("bad_request", `The description is too long (max ${BODY_MAX} characters).`);
  const id = await ctx.db.tx(async (t) => {
    const [u] = await t.query<{ name: string; status: string }>("select name, status from users where id = $1 for update", [userId]);
    if (!u) return notFound("Account");
    const [{ n } = { n: 0 }] = await t.query<{ n: number }>("select count(*)::int as n from tickets where user_id = $1 and status = 'open'", [userId]);
    if (n >= 10) return fail("conflict", "You have 10 open tickets. Wait for support to resolve some first.", 409);
    const file = await claimAttachment(t, userId, input.fileId);
    const now = ctx.now();
    const [tk] = await t.query<{ id: string }>("insert into tickets (workspace_id, user_id, title, created_at, updated_at) values ($1,$2,$3,$4,$4) returning id", [ctx.cfg.workspaceId, userId, title, now]);
    await t.query("insert into ticket_messages (ticket_id, sender_type, sender_id, sender_name, body, attachment_file_id, created_at) values ($1,'customer',$2,$3,$4,$5,$6)", [tk!.id, userId, u.name, body, file, now]);
    return tk!.id;
  });
  return full(ctx, ctx.db, id, userId);
}

export async function userSendMessage(ctx: Ctx, userId: string, ticketId: string, rawBody: string): Promise<Ticket> {
  const body = rawBody.trim();
  if (!body) fail("bad_request", "Type a message first.");
  if (body.length > BODY_MAX) fail("bad_request", `That message is too long (max ${BODY_MAX} characters).`);
  await ctx.db.tx(async (t) => {
    const [tk] = await t.query<{ status: string }>("select status from tickets where id = $1 and user_id = $2 for update", [ticketId, userId]);
    if (!tk) return notFound("Ticket");
    if (tk.status === "closed") return conflict("ticket_closed", "This ticket is resolved. Create a new ticket for more help.");
    const [u] = await t.query<{ name: string; status: string }>("select name, status from users where id = $1", [userId]);
    if (u?.status !== "active") return fail("suspended", "This account cannot send messages.", 403);
    const now = ctx.now();
    await t.query("insert into ticket_messages (ticket_id, sender_type, sender_id, sender_name, body, created_at) values ($1,'customer',$2,$3,$4,$5)", [ticketId, userId, u.name, body, now]);
    await t.query("update tickets set updated_at = $2 where id = $1", [ticketId, now]);
  });
  return full(ctx, ctx.db, ticketId, userId);
}

/* ---------- support side ---------- */

/** Every open ticket, then the newest `closedLimit` resolved ones; the screen asks for more with a bigger limit. */
export async function listAdminTickets(ctx: Ctx, actor: AdminActor, closedLimit = 50): Promise<Ticket[]> {
  needs(actor, "ticket.manage");
  const rows = await ctx.db.query<TicketRow>(
    `(${SELECT} where t.workspace_id = $1 and t.status = 'open' order by t.updated_at desc limit 1000)
     union all (${SELECT} where t.workspace_id = $1 and t.status = 'closed' order by t.updated_at desc, t.id limit $2)`, [ctx.cfg.workspaceId, closedLimit]);
  return rows.map((r) => toTicket(r));
}
export async function getAdminTicket(ctx: Ctx, actor: AdminActor, id: string): Promise<Ticket> {
  needs(actor, "ticket.manage");
  return full(ctx, ctx.db, id);
}

export async function ticketAgents(ctx: Ctx, actor: AdminActor): Promise<{ id: string; name: string }[]> {
  needs(actor, "ticket.manage");
  return ctx.db.query<{ id: string; name: string }>(
    `select u.id, u.name from admin_members m join users u on u.id = m.user_id
     where m.workspace_id = $1 and u.status = 'active' and (m.is_owner or exists (
       select 1 from member_roles mr join role_permissions rp on rp.role_id = mr.role_id where mr.user_id = m.user_id and rp.permission = 'ticket.manage'))
     order by u.name`, [ctx.cfg.workspaceId]);
}

async function lockOpen(t: Queryable, ctx: Ctx, id: string): Promise<void> {
  const [tk] = await t.query<{ status: string }>("select status from tickets where id = $1 and workspace_id = $2 for update", [id, ctx.cfg.workspaceId]);
  if (!tk) return notFound("Ticket");
  if (tk.status === "closed") return conflict("ticket_closed", "This ticket is resolved.");
}
const system = (t: Queryable, id: string, body: string, at: Date) =>
  t.query("insert into ticket_messages (ticket_id, sender_type, sender_name, body, created_at) values ($1,'system','System',$2,$3)", [id, body, at]);

export async function assignTicket(ctx: Ctx, actor: AdminActor, id: string, assigneeId: string | null): Promise<Ticket> {
  needs(actor, "ticket.manage");
  await ctx.db.tx(async (t) => {
    await lockOpen(t, ctx, id);
    let name: string | null = null;
    if (assigneeId) {
      const agent = await loadAdmin(t, assigneeId);
      if (!agent || !agent.permissions.has("ticket.manage")) return fail("bad_request", "That person cannot handle support tickets.");
      name = agent.name;
    }
    const [cur] = await t.query<{ assignee_id: string | null }>("select assignee_id from tickets where id = $1", [id]);
    if ((cur?.assignee_id ?? null) === assigneeId) return;
    const now = ctx.now();
    await t.query("update tickets set assignee_id = $2, updated_at = $3 where id = $1", [id, assigneeId, now]);
    await system(t, id, name ? `Assigned to ${name}${assigneeId === actor.userId ? "" : ` by ${actor.name}`}` : `Unassigned by ${actor.name}`, now);
    await audit(t, ctx, actor.userId, "ticket.assign", { type: "ticket", id }, { assigneeId });
  });
  return full(ctx, ctx.db, id);
}

export async function replyTicket(ctx: Ctx, actor: AdminActor, id: string, rawBody: string): Promise<Ticket> {
  needs(actor, "ticket.manage");
  const body = rawBody.trim();
  if (!body) fail("bad_request", "Type a reply first.");
  if (body.length > BODY_MAX) fail("bad_request", `That reply is too long (max ${BODY_MAX} characters).`);
  await ctx.db.tx(async (t) => {
    await lockOpen(t, ctx, id);
    const now = ctx.now();
    await t.query("insert into ticket_messages (ticket_id, sender_type, sender_id, sender_name, body, created_at) values ($1,'admin',$2,$3,$4,$5)", [id, actor.userId, `${actor.name} (Support)`, body, now]);
    await t.query("update tickets set updated_at = $2 where id = $1", [id, now]);
  });
  return full(ctx, ctx.db, id);
}

export async function resolveTicket(ctx: Ctx, actor: AdminActor, id: string): Promise<Ticket> {
  needs(actor, "ticket.manage");
  await ctx.db.tx(async (t) => {
    await lockOpen(t, ctx, id);
    const now = ctx.now();
    await t.query("update tickets set status = 'closed', resolved_at = $2, updated_at = $2 where id = $1", [id, now]);
    await system(t, id, `Marked as resolved by ${actor.name}`, now);
    await audit(t, ctx, actor.userId, "ticket.resolve", { type: "ticket", id });
  });
  return full(ctx, ctx.db, id);
}

