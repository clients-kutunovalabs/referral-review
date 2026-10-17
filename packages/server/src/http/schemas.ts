import { z } from "zod";
import { OUTCOME_PERCENTS } from "@rr/money";
import { PERMISSIONS } from "@rr/core";

const text = (max: number) => z.string().max(max);
const email = z.string().trim().min(3).max(254);
const id = z.string().uuid();
/** Money arrives as a string of paise, never a JSON number. */
const paise = z.string().regex(/^\d{1,12}$/, "Amount must be whole paise.").transform((s) => BigInt(s));
const permission = z.enum(PERMISSIONS.map((p) => p.key) as [string, ...string[]]);

export const schemas = {
  requestCode: z.object({ email, purpose: z.enum(["signup", "reset"]), profile: z.object({ name: text(100).optional(), phone: text(30).optional() }).strict().optional() }).strict(),
  verifyCode: z.object({ email, code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."), purpose: z.enum(["signup", "reset"]) }).strict(),
  ticketPassword: z.object({ ticket: text(200), password: text(200) }).strict(),
  signIn: z.object({ email, password: text(200) }).strict(),
  claim: z.object({ taskId: id, identityId: id }).strict(),
  submit: z.object({ fileId: id, note: text(2100).optional() }).strict(),
  payout: z.object({ amountPaise: paise, upi: text(120) }).strict(),
  rejectPayout: z.object({ reason: text(200) }).strict(),
  releaseUpi: z.object({ upi: text(120) }).strict(),
  sendIdentityCode: z.object({ email }).strict(),
  addIdentity: z.object({ email, code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code.") }).strict(),
  newTicket: z.object({ title: text(120), body: text(5100), fileId: id.nullish() }).strict(),
  message: z.object({ body: text(5100) }).strict(),

  newTask: z.object({
    title: text(200), description: text(5000), siteUrl: text(500), reward: paise,
    slotsTotal: z.number().int().positive().max(1_000_000).nullable(), timerMinutes: z.number().int().positive().max(100_000).nullable(),
    activeUntil: z.string().datetime({ offset: true }).nullable(), textMode: z.enum(["none", "keywords", "manual_pool", "ai_generated"]),
    keywords: z.array(text(100)).max(30), scripts: z.array(text(5000)).max(200),
    aiConfig: z.object({ tone: z.enum(["friendly", "professional", "persuasive", "casual"]), language: text(60), minWords: z.number().int(), maxWords: z.number().int(), style: z.enum(["cold_message", "call_script", "email"]) }).strict().optional(),
    maxClaimsPerAccount: z.number().int().positive().max(1000).nullable()
  }).strict(),
  taskStatus: z.object({ status: z.enum(["active", "paused", "removed"]) }).strict(),
  scripts: z.object({ scripts: z.array(text(5000)).min(1).max(200) }).strict(),
  decide: z.object({ outcome: z.number().refine((n) => (OUTCOME_PERCENTS as readonly number[]).includes(n), "Outcome must be 100, 75, 50, 25 or 0."), note: text(2000) }).strict(),
  pay: z.object({ proofFileId: id }).strict(),
  userStatus: z.object({ status: z.enum(["active", "suspended", "deleted"]) }).strict(),
  addMember: z.object({ email }).strict(),
  memberRoles: z.object({ roleIds: z.array(id).max(50) }).strict(),
  newRole: z.object({ name: text(80) }).strict(),
  rolePermissions: z.object({ permissions: z.array(permission).max(20) }).strict(),
  assign: z.object({ assigneeId: id.nullable() }).strict(),
  reply: z.object({ body: text(5100) }).strict()
};
