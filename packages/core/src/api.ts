/**
 * The API between the UI and whatever serves it. The UI only ever calls these two interfaces.
 * Implementations: an HTTP client (production), an in-memory mock (ui-hub). The server implements the same operations.
 * Money is always Paise (bigint) here; the HTTP layer sends it as decimal strings.
 */
import type { OutcomePercent, Paise } from "@rr/money";
import type {
  AdminMember, AdminUserRow, AiConfig, Claim, Identity, PayoutRequest, PermissionKey, ReviewQueueItem, Role, Task, TaskStatus,
  TextMode, Ticket, WalletEntry
} from "./contracts";

export type ApiErrorCode =
  | "bad_request" | "unauthenticated" | "forbidden" | "not_found" | "conflict" | "rate_limited" | "csrf" | "internal"
  | "suspended" | "slots_full" | "task_closed" | "already_claimed" | "claim_limit" | "insufficient_balance" | "below_minimum"
  | "payout_pending" | "invalid_code" | "not_pending" | "ticket_closed" | "upload_invalid"
  | "code_expired" | "too_many_attempts" | "invalid_email" | "email_taken" | "weak_password" | "invalid_credentials";

export class ApiError extends Error {
  constructor(public readonly code: ApiErrorCode, message: string, public readonly status = 400, public readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
  }
}

/* ---------- user side ---------- */

export interface Me {
  userId: string;
  name: string;
  phone: string | null;
  email: string; // main login
  identities: Identity[];
  isAdmin: boolean;
}

export interface WalletView {
  earned: Paise;
  entries: WalletEntry[];
  identities: Identity[];
  payouts: PayoutRequest[];
}

export interface NewTicketInput { title: string; body: string; file?: File | null }

export interface UserApi {
  me(): Promise<Me>;
  listTasks(): Promise<Task[]>;
  listClaims(): Promise<Claim[]>;
  claimTask(taskId: string, identityId: string): Promise<Claim>;
  /** Asks again for an AI script that could not be written the first time. */
  retryClaimText(claimId: string): Promise<Claim>;
  submitProof(claimId: string, input: { file: File; note: string }): Promise<void>;
  wallet(): Promise<WalletView>;
  requestPayout(amount: Paise, upi: string): Promise<PayoutRequest>;
  /** Checks the one-time code sent by emailVerification.send and, if right, links the email to this account. */
  addIdentity(email: string, code: string): Promise<Identity>;
  listTickets(): Promise<Ticket[]>;
  getTicket(id: string): Promise<Ticket>;
  createTicket(input: NewTicketInput): Promise<Ticket>;
  sendTicketMessage(ticketId: string, body: string): Promise<Ticket>;
}

/* ---------- admin side ---------- */

export interface AdminMe { userId: string; name: string; isOwner: boolean; roleIds: string[]; permissions: PermissionKey[] }

export interface DashboardView {
  pendingReview: number;
  activeTasks: number;
  payoutsDue: number;
  openTickets: number;
  ticketsNeedReply: number;
  recent: { kind: "reviewqueue" | "tickets" | "payouts" | "tasks"; text: string; at: string }[];
}

export interface AdminTaskRow {
  id: string;
  title: string;
  reward: Paise;
  slotsTotal: number | null;
  claimed: number;
  timerMinutes: number | null;
  activeUntil: string | null;
  textMode: TextMode;
  status: TaskStatus;
}
export interface AdminTaskDetail extends AdminTaskRow {
  description: string;
  siteUrl: string;
  keywords: string[];
  aiConfig?: AiConfig;
  maxClaimsPerAccount: number | null;
  scripts: string[];
}
export interface NewTaskInput {
  title: string;
  description: string;
  siteUrl: string;
  reward: Paise;
  slotsTotal: number | null;
  timerMinutes: number | null;
  activeUntil: string | null;
  textMode: TextMode;
  keywords: string[];
  scripts: string[];
  aiConfig?: AiConfig;
  maxClaimsPerAccount: number | null;
}

export interface AdminApi {
  me(): Promise<AdminMe>;
  dashboard(): Promise<DashboardView>;

  listTasks(): Promise<AdminTaskRow[]>;
  getTask(id: string): Promise<AdminTaskDetail>;
  createTask(input: NewTaskInput): Promise<AdminTaskRow>;
  setTaskStatus(id: string, status: "active" | "paused" | "removed"): Promise<void>;
  addScripts(id: string, scripts: string[]): Promise<string[]>;

  reviewQueue(): Promise<ReviewQueueItem[]>;
  decide(submissionId: string, outcome: OutcomePercent, note: string): Promise<void>;

  listPayouts(): Promise<PayoutRequest[]>;
  /** Includes the full UPI ID. Reading it is audit-logged. */
  getPayout(id: string): Promise<PayoutRequest>;
  markPaid(id: string, proof: File): Promise<void>;

  listUsers(): Promise<AdminUserRow[]>;
  setUserStatus(userId: string, status: "active" | "suspended" | "deleted"): Promise<void>;

  listMembers(): Promise<AdminMember[]>;
  addMember(email: string): Promise<AdminMember>;
  setMemberRoles(userId: string, roleIds: string[]): Promise<void>;
  listRoles(): Promise<Role[]>;
  createRole(name: string): Promise<Role>;
  setRolePermissions(roleId: string, permissions: PermissionKey[]): Promise<void>;
  deleteRole(roleId: string): Promise<void>;

  listTickets(): Promise<Ticket[]>;
  getTicket(id: string): Promise<Ticket>;
  assignTicket(id: string, assigneeUserId: string | null): Promise<Ticket>;
  replyTicket(id: string, body: string): Promise<Ticket>;
  resolveTicket(id: string): Promise<Ticket>;
  /** People who can be assigned tickets (hold ticket.manage). */
  ticketAgents(): Promise<{ id: string; name: string }[]>;
}

export interface Api { user: UserApi; admin: AdminApi }
