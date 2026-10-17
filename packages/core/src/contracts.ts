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
  timerMinutes: number | null; // time limit once claimed, in minutes. null = unlimited
  activeUntil: string | null; // ISO date-time the task stops accepting claims; null = no end date
  status: TaskStatus;
  keywords: string[];
  textMode: TextMode;
  aiConfig?: AiConfig;
  maxClaimsPerAccount: number | null;
}

export type ClaimStatus = "claimed" | "under_review" | "approved" | "partial" | "rejected" | "expired" | "void";
/** Script hand-out for a claim: "pending" while an AI script is still being written, "failed" if it could not be (worker can retry). */
export type TextStatus = "none" | "ready" | "pending" | "failed";

export interface Claim {
  id: string;
  taskId: string;
  identityId: string;
  identityEmail: string;
  status: ClaimStatus;
  /** the reward is fixed when the task is claimed, so later edits never change what was promised */
  taskTitle: string;
  siteUrl: string;
  keywords: string[];
  reward: Paise;
  minutesLeft?: number; // active claims only; undefined = no time limit
  expiresAt?: string; // ISO: when the timer runs out, so countdowns stay right after a reload
  submittedAt?: string; // ISO
  reviewedAt?: string; // ISO: when it was reviewed / ended
  assignedText?: string; // script given at claim time
  textStatus?: TextStatus;
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
  at: string; // ISO, for ordering and display
  reviewerNote?: string;
}

export interface Wallet {
  earned: Paise; // total ever credited; withdrawn, in-process and withdrawable are derived from payouts
  entries: WalletEntry[];
}

export type PayoutStatus = "pending" | "paid" | "rejected";
export interface PayoutRequest {
  id: string;
  who: string;
  amount: Paise;
  status: PayoutStatus;
  upiMasked: string;
  upiFull?: string; // only ever sent for, and rendered on, the admin payout detail screen
  at: string; // ISO: when requested
  paidAt?: string; // ISO: when marked paid
  paidBy?: string;
  rejectReason?: string; // why a payer refused it; the held amount is back in the worker's balance
  rejectedAt?: string; // ISO
  proofUrl?: string; // payment screenshot, admin side only
}

export interface ReviewQueueItem {
  id: string;
  worker: string;
  identityEmail: string;
  taskTitle: string;
  reward: Paise;
  submittedAt: string; // ISO
  waitingMinutes: number; // for sorting and the "12 min ago" label
  proofUrl?: string; // the screenshot
  timeLimitMinutes: number | null; // the task's limit, null = unlimited
  timeTakenMinutes: number; // claim start to proof submitted
  workerNote?: string;
  keywords: string[];
  keywordsMatched: string[];
  assignedText?: string;
}

export interface AdminUserRow {
  id: string;
  name: string;
  emailMasked: string;
  status: "active" | "suspended" | "deleted";
  lifetime: Paise;
  identityCount: number;
}

export const PERMISSIONS = [
  { key: "task.manage", label: "Create and edit tasks" },
  { key: "task.assign", label: "Assign tasks" },
  { key: "task_text.manage", label: "Manage scripts" },
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

/** "Task script" options. Stored values stay none | manual_pool | ai_generated | keywords. */
export const TEXT_MODE_LABEL: Record<TextMode, string> = {
  none: "None",
  manual_pool: "Manual",
  ai_generated: "AI",
  keywords: "Keywords"
};
/** Order shown while creating a task. */
export const TEXT_MODE_ORDER: TextMode[] = ["none", "manual_pool", "ai_generated", "keywords"];

export const TEXT_MODE_HELP: Record<TextMode, string> = {
  none: "Workers write in their own words.",
  manual_pool: "You write the scripts. Each worker gets one at random, spread evenly.",
  ai_generated: "A new script is written for each worker.",
  keywords: "Workers see the keywords to mention."
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
  resolvedAt?: string; // ISO, set when an admin marks it resolved
  /** Lists send tickets without messages and say here whether the customer spoke last. */
  needsReply?: boolean;
  messages: TicketMessage[];
}
