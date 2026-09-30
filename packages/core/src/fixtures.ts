/** Mock data for ui-hub and design review. Not used in production builds of the real apps. */
import { rupees } from "@rr/money";
import type {
  AdminMember, AdminUserRow, Claim, Identity, PayoutRequest, ReviewQueueItem, Role, Task, Wallet
} from "./contracts";

export const tasks: Task[] = [
  {
    id: "t1",
    title: "Pitch our CRM to a local clinic",
    description:
      "Reach out to a clinic or practice owner and pitch the CRM. Book a demo or get a clear yes/no. Screenshot the conversation as proof.",
    siteUrl: "https://kutunovalabs.com/crm",
    reward: rupees(40),
    slotsTotal: 100,
    slotsRemaining: 32,
    timerMinutes: 30,
    proofType: "screenshot_note",
    status: "active",
    keywords: ["appointment reminders", "patient records", "free 14-day trial"],
    textMode: "manual_pool",
    maxClaimsPerAccount: null
  },
  {
    id: "t2",
    title: "Sign up 3 leads for the newsletter",
    description: "Share the signup link with three prospects and screenshot the confirmations.",
    siteUrl: "https://kutunovalabs.com/newsletter",
    reward: rupees(15),
    slotsTotal: null,
    slotsRemaining: null,
    timerMinutes: 15,
    proofType: "screenshot",
    status: "active",
    keywords: [],
    textMode: "none",
    maxClaimsPerAccount: 3
  },
  {
    id: "t3",
    title: "Write and send a follow-up email",
    description: "Send a follow-up email to a warm lead using the generated pitch. Attach a screenshot of the sent email.",
    siteUrl: "https://kutunovalabs.com/pricing",
    reward: rupees(60),
    slotsTotal: 20,
    slotsRemaining: 4,
    timerMinutes: 45,
    proofType: "screenshot_link",
    status: "closing_soon",
    keywords: ["pricing", "onboarding support"],
    textMode: "ai_generated",
    aiConfig: { tone: "professional", language: "English", minWords: 60, maxWords: 120, style: "email" },
    maxClaimsPerAccount: null
  }
];

export const identities: Identity[] = [
  { id: "i1", email: "priya@gmail.com", isPrimary: true, earned: rupees(310) },
  { id: "i2", email: "priya.sales@outlook.com", isPrimary: false, earned: rupees(110) }
];

export const activeClaim: Claim = {
  id: "c1",
  taskId: "t1",
  identityId: "i1",
  status: "claimed",
  minutesLeft: 18,
  assignedText:
    "Hi Dr. Rao, I help clinics cut no-shows with automatic appointment reminders and keep patient records in one place. Can I show you a 10-minute demo this week? There's a free 14-day trial, no card needed."
};

export const claims: Claim[] = [
  activeClaim,
  { id: "c2", taskId: "t2", identityId: "i1", status: "under_review", submittedLabel: "2 hours ago" },
  { id: "c3", taskId: "t3", identityId: "i2", status: "approved", outcome: 100, credited: rupees(60), reviewerNote: "Email sent, screenshot clear." },
  { id: "c4", taskId: "t2", identityId: "i1", status: "partial", outcome: 50, credited: rupees(10), reviewerNote: "Only two of three signups visible." },
  { id: "c5", taskId: "t1", identityId: "i2", status: "rejected", outcome: 0, credited: 0n, reviewerNote: "Screenshot did not show a sent message." }
];

export const wallet: Wallet = {
  earned: rupees(420),
  withdrawn: rupees(250),
  held: rupees(0),
  available: rupees(170),
  entries: [
    { id: "w1", title: "Write and send a follow-up email", identityId: "i2", outcome: 100, reward: rupees(60), credited: rupees(60), whenLabel: "4 Sep, 6:12 PM", reviewerNote: "Email sent, screenshot clear." },
    { id: "w2", title: "Sign up 3 leads for the newsletter (50%)", identityId: "i1", outcome: 50, reward: rupees(20), credited: rupees(10), whenLabel: "3 Sep, 11:04 AM", reviewerNote: "Only two of three signups visible, rest of proof was valid." },
    { id: "w3", title: "Pitch our CRM to a local clinic", identityId: "i1", outcome: 100, reward: rupees(35), credited: rupees(35), whenLabel: "1 Sep, 9:30 AM" }
  ]
};

export const userPayouts: PayoutRequest[] = [
  { id: "p1", who: "You", amount: rupees(250), status: "paid", upiMasked: "pri••@okhdfc", upiFull: "priya@okhdfc", whenLabel: "Requested 3 days ago", paidBy: "Anil (Payments)" },
  { id: "p2", who: "You", amount: rupees(170), status: "pending", upiMasked: "pri••@okhdfc", upiFull: "priya@okhdfc", whenLabel: "Requested today" }
];

export const adminPayouts: PayoutRequest[] = [
  { id: "a1", who: "Rahul K.", amount: rupees(170), status: "pending", upiMasked: "rahul••@upi", upiFull: "rahul.kumar@okhdfc", whenLabel: "1 hour ago" },
  { id: "a2", who: "Sara M.", amount: rupees(90), status: "pending", upiMasked: "sara••@upi", upiFull: "sara.m@oksbi", whenLabel: "4 hours ago" },
  { id: "a3", who: "Karan D.", amount: rupees(220), status: "flagged", upiMasked: "9876•••@upi", upiFull: "9876543210@ybl", whenLabel: "yesterday", flagReason: "This UPI ID matches an existing UPI on another account (Meena D.)." }
];

export const reviewQueue: ReviewQueueItem[] = [
  {
    id: "r1",
    worker: "Priya S.",
    identityEmail: "priya••@gmail.com",
    taskTitle: "Pitch our CRM to a local clinic",
    reward: rupees(40),
    waitingLabel: "12 min ago",
    workerNote: "Pitched Dr. Rao, demo booked for Friday. Screenshot attached above.",
    keywords: ["appointment reminders", "patient records", "free 14-day trial"],
    keywordsMatched: ["appointment reminders", "free 14-day trial"],
    assignedText: activeClaim.assignedText
  },
  { id: "r2", worker: "Amit V.", identityEmail: "amit••@gmail.com", taskTitle: "Sign up 3 leads for the newsletter", reward: rupees(15), waitingLabel: "1 hour ago", keywords: [], keywordsMatched: [] },
  { id: "r3", worker: "Neha J.", identityEmail: "neha••@gmail.com", taskTitle: "Write and send a follow-up email", reward: rupees(60), waitingLabel: "3 hours ago", keywords: ["pricing", "onboarding support"], keywordsMatched: ["pricing"] }
];

export const adminUsers: AdminUserRow[] = [
  { id: "u1", name: "Priya S.", emailMasked: "priya••@gmail.com", status: "active", lifetime: rupees(540), identityCount: 2 },
  { id: "u2", name: "Rahul K.", emailMasked: "rahul••@gmail.com", status: "active", lifetime: rupees(320), identityCount: 1 },
  { id: "u3", name: "Karan D.", emailMasked: "karan••@gmail.com", status: "flagged", lifetime: rupees(220), identityCount: 1 },
  { id: "u4", name: "Old User", emailMasked: "old••@gmail.com", status: "deleted", lifetime: rupees(80), identityCount: 1 }
];

export const roles: Role[] = [
  { id: "role-owner", name: "Owner", permissions: ["task.manage", "task.assign", "task_text.manage", "review.decide", "payout.mark_paid", "user.manage", "role.manage", "design.view"] },
  { id: "role-payments", name: "Payments", permissions: ["payout.mark_paid"] },
  { id: "role-tasks", name: "Task manager", permissions: ["task.manage", "task.assign", "task_text.manage"] },
  { id: "role-reviewer", name: "Reviewer", permissions: ["review.decide"] }
];

export const members: AdminMember[] = [
  { id: "m1", name: "Hrishabh (owner)", isOwner: true, roleIds: ["role-owner"] },
  { id: "m2", name: "Anil", isOwner: false, roleIds: ["role-payments"] },
  { id: "m3", name: "Sneha", isOwner: false, roleIds: ["role-tasks", "role-reviewer"] }
];

export const pitchPool: string[] = [
  "Hi Dr. Rao, I help clinics cut no-shows with automatic appointment reminders. Can I show you a 10-minute demo this week?",
  "Hello, quick question: how do you keep patient records today? Our CRM puts them in one place and has a free 14-day trial.",
  "Hi, we're helping clinics in your area save 5 hours a week on scheduling. Would a short call on Thursday work?"
];
