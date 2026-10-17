/**
 * An in-memory stand-in for the real API, used by ui-hub and the standalone prototype files. It behaves like the server where
 * it matters for a demo: a claim made on the user side shows up in the admin review queue, a review credits the worker's
 * wallet, a payout request shows up for the payer, and paying it moves the money. Nothing here is used in production.
 */
import {
  ApiError, fixtures, type AdminApi, type AdminMember, type AdminTaskDetail, type AdminTaskRow, type AdminUserRow, type Api, type Claim, type Identity, type NewTaskInput,
  type PayoutRequest, type PayoutScenario, type PermissionKey, type ReviewQueueItem, type Role, type Task, type Ticket, type TicketMessage, type UserApi, type WalletEntry
} from "@rr/core";
import { outcomeAmount, type OutcomePercent } from "@rr/money";

const WORKER = "Priya S.";
const PRIYA_EMAIL = "priya@gmail.com";
const wait = <T>(v: T): Promise<T> => Promise.resolve(structuredClone(v));
const clone = <T>(v: T): T => structuredClone(v);

export interface MockOptions {
  payoutScenario?: PayoutScenario;
  /** The role the admin is viewing as. Drives which permissions `me()` reports. */
  viewerRoleId?: string;
  /** The one-time code the demo accepts when adding an email. */
  demoCode: string;
  demoPassword?: string;
}

export interface Mock { api: Api; markNextPayoutPaid(): void }

export function createMockApi(opts: MockOptions): Mock {
  const tasks: Task[] = clone(fixtures.tasks);
  const claims: Claim[] = clone(fixtures.claims);
  const identities: Identity[] = clone(fixtures.identities);
  const entries: WalletEntry[] = clone(fixtures.wallet.entries);
  let earned = fixtures.wallet.earned;
  const myPayouts: PayoutRequest[] = clone(fixtures.payoutScenarios[opts.payoutScenario ?? "processing"]);
  const otherPayouts: PayoutRequest[] = clone(fixtures.adminPayouts);
  const queue: ReviewQueueItem[] = clone(fixtures.reviewQueue);
  const users: AdminUserRow[] = clone(fixtures.adminUsers);
  const roles: Role[] = clone(fixtures.roles);
  const members: AdminMember[] = clone(fixtures.members);
  const tickets: Ticket[] = clone(fixtures.tickets);
  const scripts: Record<string, string[]> = { t1: [...fixtures.scriptPool], t5: [...fixtures.scriptPool] };
  const closedExtras: AdminTaskRow[] = [
    { id: "x1", title: "Rate us on the App Store", reward: 2500n, slotsTotal: 100, claimed: 100, timerMinutes: 20, activeUntil: null, textMode: "none", status: "closed" },
    { id: "x2", title: "Follow our Instagram", reward: 2000n, slotsTotal: null, claimed: 0, timerMinutes: 10, activeUntil: null, textMode: "none", status: "removed" }
  ];
  let seq = 100;
  const id = (p: string) => `${p}${seq++}`;
  const now = () => new Date().toISOString();
  const viewer = opts.viewerRoleId ?? "role-owner";
  const perms = (): PermissionKey[] => roles.find((r) => r.id === viewer)?.permissions ?? [];
  const must = (...any: PermissionKey[]) => { if (!any.some((p) => perms().includes(p))) throw new ApiError("forbidden", "You do not have permission to do that.", 403); };

  const msg = (m: Omit<TicketMessage, "id" | "at">): TicketMessage => ({ ...m, id: id("m"), at: now() });
  const ticketList = (t: Ticket): Ticket => {
    const last = [...t.messages].reverse().find((m) => m.sender !== "system");
    return { ...t, messages: [], needsReply: t.status === "open" && last?.sender === "customer" };
  };
  const getTicket = (tid: string): Ticket => {
    const t = tickets.find((x) => x.id === tid);
    if (!t) throw new ApiError("not_found", "Ticket was not found.", 404);
    const last = [...t.messages].reverse().find((m) => m.sender !== "system");
    return clone({ ...t, needsReply: t.status === "open" && last?.sender === "customer" });
  };
  const touch = (t: Ticket, m: TicketMessage) => { t.messages.push(m); t.updatedAt = m.at; };

  const taskRow = (t: Task): AdminTaskRow => ({
    id: t.id, title: t.title, reward: t.reward, slotsTotal: t.slotsTotal, claimed: t.slotsTotal === null ? 0 : t.slotsTotal - (t.slotsRemaining ?? 0),
    timerMinutes: t.timerMinutes, activeUntil: t.activeUntil, textMode: t.textMode, status: t.status
  });
  const payerList = (): PayoutRequest[] => {
    const all = [...myPayouts.map((p) => ({ ...p, who: WORKER })), ...otherPayouts];
    return all.sort((a, b) => (a.status === b.status ? 0 : a.status === "pending" ? -1 : 1)).map((p) => { const { upiFull: _full, ...rest } = p; void _full; return rest; });
  };
  const findPayout = (pid: string) => [...myPayouts, ...otherPayouts].find((p) => p.id === pid);

  const user: UserApi = {
    me: () => wait({ userId: "u1", name: WORKER, phone: "9876543210", email: PRIYA_EMAIL, identities, isAdmin: false }),
    listTasks: () => wait(tasks),
    listClaims: () => wait(claims),
    async claimTask(taskId, identityId) {
      const t = tasks.find((x) => x.id === taskId);
      const ident = identities.find((i) => i.id === identityId);
      if (!t || !ident) throw new ApiError("not_found", "Task was not found.", 404);
      if (t.status === "closed" || t.slotsRemaining === 0) throw new ApiError("slots_full", "All slots for this task are taken.", 409);
      if (claims.some((c) => c.taskId === taskId && c.identityId === identityId && c.status !== "void" && c.status !== "expired")) throw new ApiError("already_claimed", "You already claimed this task with this email.", 409);
      const n = claims.filter((c) => c.taskId === taskId).length;
      const text = t.textMode === "manual_pool" ? fixtures.scriptPool[n % fixtures.scriptPool.length]
        : t.textMode === "ai_generated" ? `Hi, I wanted to follow up about ${t.keywords.join(" and ") || t.title}. We can get you set up quickly and our team will support the onboarding. Would you be open to a short call this week?` : undefined;
      const c: Claim = {
        id: id("c"), taskId, identityId, identityEmail: ident.email, status: "claimed", taskTitle: t.title, siteUrl: t.siteUrl, keywords: t.keywords, reward: t.reward,
        ...(t.timerMinutes === null ? {} : { minutesLeft: t.timerMinutes, expiresAt: new Date(Date.now() + t.timerMinutes * 60_000).toISOString() }),
        ...(text ? { assignedText: text, textStatus: "ready" as const } : {})
      };
      claims.unshift(c);
      if (t.slotsRemaining !== null) t.slotsRemaining -= 1;
      return clone(c);
    },
    retryClaimText: (claimId) => wait(claims.find((c) => c.id === claimId) as Claim),
    async submitProof(claimId, { note }) {
      const c = claims.find((x) => x.id === claimId);
      if (!c || c.status !== "claimed") throw new ApiError("conflict", "This task was already submitted or ended.", 409);
      c.status = "under_review"; c.submittedAt = now(); delete c.minutesLeft; delete c.expiresAt;
      queue.push({
        id: `sub-${c.id}`, worker: WORKER, identityEmail: "priya••@gmail.com", taskTitle: c.taskTitle, reward: c.reward, submittedAt: c.submittedAt, waitingMinutes: 0,
        timeLimitMinutes: tasks.find((t) => t.id === c.taskId)?.timerMinutes ?? null, timeTakenMinutes: 10, ...(note.trim() ? { workerNote: note.trim() } : {}),
        keywords: c.keywords, keywordsMatched: c.keywords.filter((k) => note.toLowerCase().includes(k.toLowerCase())), ...(c.assignedText ? { assignedText: c.assignedText } : {})
      });
    },
    wallet: () => wait({ earned, entries: [...entries].sort((a, b) => (a.at < b.at ? 1 : -1)), identities, payouts: myPayouts.map((p) => { const { upiFull: _f, ...rest } = p; void _f; return rest; }) }),
    async requestPayout(amount, upi) {
      if (myPayouts.some((p) => p.status === "pending")) throw new ApiError("payout_pending", "You already have a payout request processing.", 409);
      if (upi.toLowerCase() === "taken@okhdfc") throw new ApiError("upi_unavailable", "This UPI ID can't be used for a payout. Check it and try again, or contact support.", 409);
      const [name = "", bank = ""] = upi.split("@");
      const p: PayoutRequest = { id: id("p"), who: WORKER, amount, status: "pending", upiMasked: `${name.slice(0, 3)}••@${bank}`, upiFull: upi, at: now() };
      myPayouts.unshift(p);
      const { upiFull: _f, ...rest } = p; void _f;
      return clone(rest);
    },
    async changePassword(current, next) {
      if (current !== (opts.demoPassword ?? "password123")) throw new ApiError("invalid_credentials", "Your current password is not right.", 400);
      if (next.length < 8) throw new ApiError("weak_password", "Password needs at least 8 characters.", 400);
      if (next === current) throw new ApiError("weak_password", "Choose a password that is different from the current one.", 400);
    },
    async addIdentity(email, code) {
      if (code !== opts.demoCode) throw new ApiError("invalid_code", "That code is wrong.", 400);
      if (identities.some((i) => i.email.toLowerCase() === email.toLowerCase())) throw new ApiError("email_taken", "That email is already linked to an account.", 409);
      const ident: Identity = { id: id("i"), email, isPrimary: false, earned: 0n };
      identities.push(ident);
      return clone(ident);
    },
    listTickets: () => wait(tickets.filter((t) => t.customerEmail === PRIYA_EMAIL).map(ticketList)),
    async getTicket(tid) { return getTicket(tid); },
    async createTicket({ title, body, file }) {
      const t: Ticket = {
        id: id("tk"), number: 1043 + tickets.length - fixtures.tickets.length, title, status: "open", customerName: WORKER, customerEmail: PRIYA_EMAIL, assignee: null, createdAt: now(), updatedAt: now(),
        messages: [{ id: id("m"), sender: "customer", senderName: WORKER, body, at: now(), ...(file ? { attachment: { name: file.name, url: URL.createObjectURL(file) } } : {}) }]
      };
      tickets.unshift(t);
      return getTicket(t.id);
    },
    async sendTicketMessage(tid, body) {
      const t = tickets.find((x) => x.id === tid);
      if (!t) throw new ApiError("not_found", "Ticket was not found.", 404);
      if (t.status === "closed") throw new ApiError("ticket_closed", "This ticket is resolved. Create a new ticket for more help.", 409);
      touch(t, msg({ sender: "customer", senderName: WORKER, body: body.trim() }));
      return getTicket(tid);
    }
  };

  const admin: AdminApi = {
    async me() { return { userId: "m1", name: "Hrishabh", isOwner: viewer === "role-owner", roleIds: [viewer], permissions: perms() }; },
    async dashboard() {
      const open = tickets.filter((t) => t.status === "open");
      const waiting = open.filter((t) => ticketList(t).needsReply).length;
      return {
        pendingReview: queue.length, activeTasks: tasks.filter((t) => t.status === "active" || t.status === "closing_soon").length,
        payoutsDue: payerList().filter((p) => p.status === "pending").length, openTickets: open.length, ticketsNeedReply: waiting,
        recent: [
          { kind: "reviewqueue", text: 'Priya S. submitted proof for "Introduce our CRM to a local clinic"', at: new Date(Date.now() - 12 * 60_000).toISOString() },
          { kind: "tickets", text: 'Priya S. opened a ticket: "Screenshot upload fails on my phone"', at: new Date(Date.now() - 26 * 3_600_000).toISOString() },
          { kind: "payouts", text: "Rahul K. requested a payout of ₹170", at: new Date(Date.now() - 3_600_000).toISOString() },
          { kind: "tasks", text: '"Rate us on the App Store" reached its slot limit', at: new Date(Date.now() - 3 * 3_600_000).toISOString() }
        ]
      };
    },
    async listTasks() { must("task.manage", "task.assign"); return clone([...tasks.map(taskRow), ...closedExtras]); },
    async getTask(tid) {
      must("task.manage", "task.assign");
      const t = tasks.find((x) => x.id === tid);
      if (!t) throw new ApiError("not_found", "Task was not found.", 404);
      const detail: AdminTaskDetail = { ...taskRow(t), description: t.description, siteUrl: t.siteUrl, keywords: t.keywords, ...(t.aiConfig ? { aiConfig: t.aiConfig } : {}), maxClaimsPerAccount: t.maxClaimsPerAccount, scripts: scripts[tid] ?? [] };
      return clone(detail);
    },
    async createTask(input: NewTaskInput) {
      must("task.manage");
      const t: Task = {
        id: id("t"), title: input.title, description: input.description, siteUrl: input.siteUrl, reward: input.reward, slotsTotal: input.slotsTotal, slotsRemaining: input.slotsTotal,
        timerMinutes: input.timerMinutes, activeUntil: input.activeUntil, status: "active", keywords: input.keywords, textMode: input.textMode, ...(input.aiConfig ? { aiConfig: input.aiConfig } : {}), maxClaimsPerAccount: input.maxClaimsPerAccount
      };
      tasks.unshift(t);
      if (input.scripts.length) scripts[t.id] = [...input.scripts];
      return clone(taskRow(t));
    },
    async setTaskStatus(tid, status) {
      must("task.manage");
      const t = tasks.find((x) => x.id === tid);
      if (!t) throw new ApiError("not_found", "Task was not found.", 404);
      if (status === "removed") { tasks.splice(tasks.indexOf(t), 1); closedExtras.unshift({ ...taskRow(t), status: "removed" }); }
      else t.status = status;
    },
    async addScripts(tid, add) { must("task_text.manage"); scripts[tid] = [...(scripts[tid] ?? []), ...add]; return clone(scripts[tid] as string[]); },
    async reviewQueue() { must("review.decide"); return clone(queue).map((q) => ({ ...q, waitingMinutes: Math.max(q.waitingMinutes, Math.floor((Date.now() - Date.parse(q.submittedAt)) / 60_000)) })); },
    async decide(submissionId, outcome: OutcomePercent, note) {
      must("review.decide");
      const i = queue.findIndex((q) => q.id === submissionId);
      if (i < 0) throw new ApiError("not_pending", "Someone already reviewed this submission.", 409);
      const [item] = queue.splice(i, 1);
      const credited = outcomeAmount(item!.reward, outcome);
      const c = claims.find((x) => `sub-${x.id}` === submissionId);
      if (c) {
        c.status = outcome === 100 ? "approved" : outcome === 0 ? "rejected" : "partial"; c.outcome = outcome; c.credited = credited; c.reviewerNote = note; c.reviewedAt = now();
        if (credited > 0n) {
          entries.push({ id: id("w"), title: outcome === 100 ? c.taskTitle : `${c.taskTitle} (${outcome}%)`, identityId: c.identityId, outcome, reward: c.reward, credited, at: now(), reviewerNote: note });
          earned += credited;
          const ident = identities.find((x) => x.id === c.identityId);
          if (ident) ident.earned += credited;
        }
      }
    },
    async listPayouts() { must("payout.mark_paid"); return clone(payerList()); },
    async getPayout(pid) {
      must("payout.mark_paid");
      const p = findPayout(pid);
      if (!p) throw new ApiError("not_found", "Payout request was not found.", 404);
      return clone({ ...p, who: myPayouts.includes(p) ? WORKER : p.who });
    },
    async markPaid(pid) {
      must("payout.mark_paid");
      const p = findPayout(pid);
      if (!p || p.status !== "pending") throw new ApiError("not_pending", "This payout was already paid.", 409);
      p.status = "paid"; p.paidAt = now(); p.paidBy = "Anil (Payments)";
    },
    async rejectPayout(pid, reason) {
      must("payout.mark_paid");
      const p = findPayout(pid);
      if (!p || p.status !== "pending") throw new ApiError("not_pending", "This payout is no longer pending.", 409);
      if (reason.trim().length < 3) throw new ApiError("bad_request", "Say why it is rejected, so the worker knows what to fix.", 400);
      p.status = "rejected"; p.rejectReason = reason.trim(); p.rejectedAt = now();
    },
    async releaseUpi(upi) {
      must("payout.mark_paid");
      if (upi.trim().toLowerCase() !== "taken@okhdfc") throw new ApiError("not_found", "A link for that UPI ID was not found.", 404);
    },
    async listUsers() { must("user.manage"); return clone(users); },
    async setUserStatus(uid, status) {
      must("user.manage");
      const u = users.find((x) => x.id === uid);
      if (!u) throw new ApiError("not_found", "User was not found.", 404);
      u.status = status;
    },
    async listMembers() { must("role.manage", "user.manage"); return clone(members); },
    async addMember(email) {
      must("role.manage");
      const m: AdminMember = { id: id("m"), name: email.split("@")[0] ?? email, isOwner: false, roleIds: [] };
      members.push(m);
      return clone(m);
    },
    async setMemberRoles(uid, roleIds) {
      must("role.manage");
      const m = members.find((x) => x.id === uid);
      if (!m) throw new ApiError("not_found", "Team member was not found.", 404);
      m.roleIds = roleIds;
    },
    async listRoles() { return clone(roles); },
    async createRole(name) {
      must("role.manage");
      if (roles.some((r) => r.name.toLowerCase() === name.trim().toLowerCase())) throw new ApiError("conflict", "A role with that name already exists.", 409);
      const r: Role = { id: id("role-"), name: name.trim(), permissions: [] };
      roles.push(r);
      return clone(r);
    },
    async setRolePermissions(rid, permissions) { must("role.manage"); const r = roles.find((x) => x.id === rid); if (r) r.permissions = permissions; },
    async deleteRole(rid) {
      must("role.manage");
      roles.splice(roles.findIndex((r) => r.id === rid), 1);
      for (const m of members) m.roleIds = m.roleIds.filter((x) => x !== rid);
    },
    async listTickets() { must("ticket.manage"); return clone(tickets.map(ticketList)); },
    async getTicket(tid) { must("ticket.manage"); return getTicket(tid); },
    async assignTicket(tid, assigneeUserId) {
      must("ticket.manage");
      const t = tickets.find((x) => x.id === tid);
      if (!t) throw new ApiError("not_found", "Ticket was not found.", 404);
      const agent = members.find((m) => m.id === assigneeUserId);
      const name = agent ? agent.name.replace(" (owner)", "") : null;
      if (t.status === "open" && t.assignee !== name) {
        t.assignee = name;
        touch(t, msg({ sender: "system", senderName: "System", body: name ? `Assigned to ${name}` : "Unassigned by Hrishabh" }));
      }
      return getTicket(tid);
    },
    async replyTicket(tid, body) {
      must("ticket.manage");
      const t = tickets.find((x) => x.id === tid);
      if (!t) throw new ApiError("not_found", "Ticket was not found.", 404);
      if (t.status === "closed") throw new ApiError("ticket_closed", "This ticket is resolved.", 409);
      touch(t, msg({ sender: "admin", senderName: "Hrishabh (Support)", body: body.trim() }));
      return getTicket(tid);
    },
    async resolveTicket(tid) {
      must("ticket.manage");
      const t = tickets.find((x) => x.id === tid);
      if (!t) throw new ApiError("not_found", "Ticket was not found.", 404);
      if (t.status === "open") { const m = msg({ sender: "system", senderName: "System", body: "Marked as resolved by Hrishabh" }); touch(t, m); t.status = "closed"; t.resolvedAt = m.at; }
      return getTicket(tid);
    },
    async ticketAgents() {
      return members.filter((m) => m.isOwner || roles.some((r) => m.roleIds.includes(r.id) && r.permissions.includes("ticket.manage"))).map((m) => ({ id: m.id, name: m.name.replace(" (owner)", "") }));
    }
  };

  return {
    api: { user, admin },
    markNextPayoutPaid() {
      const p = myPayouts.find((x) => x.status === "pending");
      if (p) { p.status = "paid"; p.paidAt = now(); p.paidBy = "Anil (Payments)"; }
    }
  };
}
