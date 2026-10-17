import type { PayoutRequest } from "@rr/core";
import { isUniqueViolation } from "@rr/db";
import { audit } from "./audit";
import type { Ctx } from "./ctx";
import { decryptUpi, encryptUpi, maskUpi, UPI_PATTERN } from "./crypto";
import { conflict, fail, notFound } from "./errors";
import { fileUrl } from "./files";
import { needs, type AdminActor } from "./rbac";
import { balanceOf, toPayout } from "./wallet";

export async function minPayout(ctx: Ctx): Promise<bigint> {
  const [r] = await ctx.db.query<{ value: string }>("select value from settings where workspace_id = $1 and key = 'min_payout_paise'", [ctx.cfg.workspaceId]);
  return BigInt(r?.value ?? "1000");
}

/**
 * The worker asks for money. The user row is locked first, so two requests (two tabs, a double tap) are handled one after
 * the other: the second sees the first and is refused. The amount is held from the balance from this moment.
 */
export async function requestPayout(ctx: Ctx, userId: string, amount: bigint, upiRaw: string): Promise<PayoutRequest> {
  const upi = upiRaw.trim();
  if (!UPI_PATTERN.test(upi) || upi.length > 100) fail("bad_request", "That doesn't look like a UPI ID (name@bank).");
  const min = await minPayout(ctx);
  if (amount < min) fail("below_minimum", `The minimum payout is ₹${(min / 100n).toString()}.`);
  try {
    return await ctx.db.tx(async (t) => {
      const [u] = await t.query<{ name: string; status: string }>("select name, status from users where id = $1 for update", [userId]);
      if (!u) return notFound("Account");
      if (u.status !== "active") return fail("suspended", "This account cannot request payouts.", 403);
      const bal = await balanceOf(t, userId);
      if (bal.pending > 0n) return conflict("payout_pending", "You already have a payout request processing.");
      if (amount > bal.available) return fail("insufficient_balance", "That is more than your withdrawable balance.", 409);
      const masked = maskUpi(upi);
      const [p] = await t.query<{ id: string; requested_at: Date }>(
        "insert into payout_requests (workspace_id, user_id, amount_paise, upi_encrypted, upi_masked, requested_at) values ($1,$2,$3,$4,$5,$6) returning id, requested_at",
        [ctx.cfg.workspaceId, userId, amount, encryptUpi(ctx.cfg.upiKey, upi), masked, ctx.now()]);
      return toPayout({ id: p!.id, name: u.name, amount_paise: amount, status: "pending", upi_masked: masked, requested_at: p!.requested_at, paid_at: null, paid_by: null });
    });
  } catch (err) {
    if (isUniqueViolation(err)) return conflict("payout_pending", "You already have a payout request processing.");
    throw err;
  }
}

/* ---------- admin ---------- */

export async function listPayouts(ctx: Ctx, actor: AdminActor): Promise<PayoutRequest[]> {
  needs(actor, "payout.mark_paid");
  const rows = await ctx.db.query<Parameters<typeof toPayout>[0]>(
    `(select p.id, u.name, p.amount_paise, p.status, p.upi_masked, p.requested_at, p.paid_at, pb.name as paid_by
      from payout_requests p join users u on u.id = p.user_id left join payout_payments pp on pp.payout_request_id = p.id left join users pb on pb.id = pp.paid_by
      where p.workspace_id = $1 and p.status = 'pending' order by p.requested_at limit 500)
     union all
     (select p.id, u.name, p.amount_paise, p.status, p.upi_masked, p.requested_at, p.paid_at, pb.name as paid_by
      from payout_requests p join users u on u.id = p.user_id left join payout_payments pp on pp.payout_request_id = p.id left join users pb on pb.id = pp.paid_by
      where p.workspace_id = $1 and p.status = 'paid' order by p.paid_at desc limit 200)`, [ctx.cfg.workspaceId]);
  return rows.map((r) => toPayout(r));
}

/** The one place a full UPI ID leaves the server. Every read is recorded. */
export async function getPayout(ctx: Ctx, actor: AdminActor, id: string): Promise<PayoutRequest> {
  needs(actor, "payout.mark_paid");
  const [r] = await ctx.db.query<Parameters<typeof toPayout>[0] & { upi_encrypted: string }>(
    `select p.id, u.name, p.amount_paise, p.status, p.upi_masked, p.upi_encrypted, p.requested_at, p.paid_at, pb.name as paid_by, pp.proof_file_id
     from payout_requests p join users u on u.id = p.user_id left join payout_payments pp on pp.payout_request_id = p.id left join users pb on pb.id = pp.paid_by
     where p.id = $1 and p.workspace_id = $2`, [id, ctx.cfg.workspaceId]);
  if (!r) return notFound("Payout request");
  await audit(ctx.db, ctx, actor.userId, "payout.view_upi", { type: "payout", id });
  const proof = fileUrl(r.proof_file_id);
  return toPayout(r, { upiFull: decryptUpi(ctx.cfg.upiKey, r.upi_encrypted), ...(proof ? { proofUrl: proof } : {}) });
}

/**
 * The payer has transferred the money by hand and attaches a screenshot. In one transaction: the request is locked, its
 * balance re-checked, the payment record (with the proof and who paid) and the ledger debit are written, and it turns Paid.
 */
export async function markPaid(ctx: Ctx, actor: AdminActor, id: string, proofFileId: string): Promise<void> {
  needs(actor, "payout.mark_paid");
  await ctx.db.tx(async (t) => {
    const now = ctx.now();
    const [p] = await t.query<{ user_id: string; amount_paise: bigint; status: string }>(
      "select user_id, amount_paise, status from payout_requests where id = $1 and workspace_id = $2 for update", [id, ctx.cfg.workspaceId]);
    if (!p) return notFound("Payout request");
    if (p.status !== "pending") return conflict("not_pending", "This payout was already paid.");
    const [f] = await t.query<{ id: string }>(
      "select f.id from files f where f.id = $1 and f.kind = 'payment_proof' and f.owner_user_id = $2 and not exists (select 1 from payout_payments x where x.proof_file_id = f.id)", [proofFileId, actor.userId]);
    if (!f) return fail("upload_invalid", "Attach the payment screenshot first. It is required.");
    await t.query("select 1 from users where id = $1 for update", [p.user_id]);
    const bal = await balanceOf(t, p.user_id);
    if (bal.credits - bal.debits < p.amount_paise) return fail("insufficient_balance", "The worker's balance no longer covers this payout.", 409);
    const [ident] = await t.query<{ id: string }>("select id from identities where user_id = $1 and is_primary", [p.user_id]);
    await t.query("insert into payout_payments (payout_request_id, workspace_id, paid_by, proof_file_id, paid_at) values ($1,$2,$3,$4,$5)", [id, ctx.cfg.workspaceId, actor.userId, proofFileId, now]);
    await t.query("insert into wallet_transactions (workspace_id, user_id, identity_id, kind, amount_paise, payout_request_id, created_at) values ($1,$2,$3,'debit',$4,$5,$6)",
      [ctx.cfg.workspaceId, p.user_id, ident!.id, p.amount_paise, id, now]);
    await t.query("update payout_requests set status = 'paid', paid_at = $2 where id = $1", [id, now]);
    await audit(t, ctx, actor.userId, "payout.mark_paid", { type: "payout", id }, { amount: p.amount_paise, userId: p.user_id });
  });
}

