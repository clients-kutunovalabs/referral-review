/**
 * Domain contracts consumed by the UI now and implemented by the backend later (step 4+).
 * Money is always Paise (bigint). Ids are opaque strings.
 */
import type { OutcomePercent, Paise } from "@rr/money";

export type TextMode = "none" | "keywords" | "manual_pool" | "ai_generated";
export type TaskStatus = "active" | "closing_soon" | "paused" | "closed" | "removed";

export interface AiConfig {
  tone: "friendly" | "professional" | "persuasive" | "casual";
  language: string;
  minWords: number;
  maxWords: number;
  style: "cold_message" | "call_script" | "email";
}

export interface Task {
  id: string;
  title: string;
  description: string;
  siteUrl: string;
  reward: Paise;
  slotsTotal: number | null; // null = unlimited
  slotsRemaining: number | null;
  timerMinutes: number; // time limit once claimed
  activeUntil: string | null; // ISO date-time the task stops accepting claims; null = no end date
  status: TaskStatus;
  keywords: string[];
  textMode: TextMode;
  aiConfig?: AiConfig;
  maxClaimsPerAccount: number | null;
}

export type ClaimStatus = "claimed" | "under_review" | "approved" | "partial" | "rejected" | "expired" | "void";

export interface Claim {
  id: string;
  taskId: string;
  identityId: string;
  status: ClaimStatus;
  minutesLeft?: number; // active claims only
  submittedLabel?: string;
  reviewedLabel?: string; // when it was reviewed / ended
  assignedText?: string; // pitch given at claim time
  outcome?: OutcomePercent;
  credited?: Paise;
  reviewerNote?: string;
}

export interface Identity {
  id: string;
  email: string;
  isPrimary: boolean;
  earned: Paise;
}

export interface WalletEntry {
  id: string;
  title: string;
  identityId: string;
  outcome: OutcomePercent;
  reward: Paise;
  credited: Paise;
  whenLabel: string;
  at: string; // ISO, for ordering
  reviewerNote?: string;
}

export interface Wallet {
  earned: Paise; // total ever credited; withdrawn, in-process and withdrawable are derived from payouts
  entries: WalletEntry[];
}

export type PayoutStatus = "pending" | "paid" | "flagged";
export interface PayoutRequest {
  id: string;
  who: string;
  amount: Paise;
  status: PayoutStatus;
  upiMasked: string;
  upiFull: string; // only ever rendered on the admin payout detail screen
  whenLabel: string;
  at?: string; // ISO: when requested
  paidAt?: string; // ISO: when marked paid
  flagReason?: string;
  paidBy?: string;
}

export interface ReviewQueueItem {
  id: string;
  worker: string;
  identityEmail: string;
  taskTitle: string;
  reward: Paise;
  waitingLabel: string;
  workerNote?: string;
  keywords: string[];
  keywordsMatched: string[];
  assignedText?: string;
}

export interface AdminUserRow {
  id: string;
  name: string;
  emailMasked: string;
  status: "active" | "suspended" | "deleted" | "flagged";
  lifetime: Paise;
  identityCount: number;
}

export const PERMISSIONS = [
  { key: "task.manage", label: "Create and edit tasks" },
  { key: "task.assign", label: "Assign tasks" },
  { key: "task_text.manage", label: "Manage pitch texts" },
  { key: "review.decide", label: "Review submissions" },
  { key: "payout.mark_paid", label: "Make payments" },
  { key: "user.manage", label: "Manage users" },
  { key: "ticket.manage", label: "Handle support tickets" },
  { key: "role.manage", label: "Manage roles" },
  { key: "design.view", label: "View design system" }
] as const;
export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export interface Role {
  id: string;
  name: string;
  permissions: PermissionKey[];
}

export interface AdminMember {
  id: string;
  name: string;
  isOwner: boolean;
  roleIds: string[];
}

export const TEXT_MODE_LABEL: Record<TextMode, string> = {
  none: "No text",
  keywords: "Keywords only",
  manual_pool: "Manual pitch pool",
  ai_generated: "AI-generated pitch"
};

/** Payout lifecycle states used by ui-hub scenarios. */
export type PayoutScenario = "none" | "processing" | "paid";

/** Support tickets: a customer opens one, an admin is assigned, they chat, the admin marks it resolved. */
export type TicketStatus = "open" | "closed";
export interface TicketMessage {
  id: string;
  sender: "customer" | "admin" | "system"; // system = "Assigned to ...", "Marked as resolved ..."
  senderName: string;
  body: string;
  at: string; // ISO
  attachment?: { name: string; url: string }; // image, one per ticket for now
}
export interface Ticket {
  id: string;
  number: number;
  title: string;
  status: TicketStatus;
  customerName: string;
  customerEmail: string;
  assignee: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  messages: TicketMessage[];
}
