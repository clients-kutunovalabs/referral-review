import type { PayoutRequest, WalletEntry, WalletView } from "@rr/core";
import type { Queryable } from "@rr/db";
import type { Ctx } from "./ctx";
import { getMe } from "./identities";

export interface Balance { credits: bigint; debits: bigint; pending: bigint; available: bigint }

/**
 * Always computed, never stored. available = credited - paid - held by a pending request.
 * Pass a transaction that already locked the user's row when the answer decides a payment.
 */
export async function balanceOf(q: Queryable, userId: string): Promise<Balance> {
  const [r] = await q.query<{ credits: bigint; debits: bigint; pending: bigint }>(
    `select coalesce(sum(amount_paise) filter (where kind = 'credit'), 0)::bigint as credits,
            coalesce(sum(amount_paise) filter (where kind = 'debit'), 0)::bigint as debits,
            (select coalesce(sum(amount_paise), 0) from payout_requests where user_id = $1 and status = 'pending')::bigint as pending
     from wallet_transactions where user_id = $1`, [userId]);
  const credits = r?.credits ?? 0n; const debits = r?.debits ?? 0n; const pending = r?.pending ?? 0n;
  const left = credits - debits - pending;
  return { credits, debits, pending, available: left > 0n ? left : 0n };
}

interface PayoutRow {
  id: string; name: string; amount_paise: bigint; status: "pending" | "paid"; upi_masked: string; requested_at: Date; paid_at: Date | null; paid_by: string | null; proof_file_id?: string | null;
}
export const toPayout = (r: PayoutRow, extra: Partial<PayoutRequest> = {}): PayoutRequest => ({
  id: r.id, who: r.name, amount: r.amount_paise, status: r.status, upiMasked: r.upi_masked, at: r.requested_at.toISOString(),
  ...(r.paid_at ? { paidAt: r.paid_at.toISOString() } : {}), ...(r.paid_by ? { paidBy: r.paid_by } : {}), ...extra
});

export async function walletView(ctx: Ctx, userId: string): Promise<WalletView> {
  const me = await getMe(ctx, userId);
  const entries = await ctx.db.query<{ id: string; title: string; identity_id: string; outcome_pct: number; reward_paise: bigint; amount_paise: bigint; created_at: Date; note: string }>(
    `select w.id, t.title, w.identity_id, r.outcome_pct, c.reward_paise, w.amount_paise, w.created_at, r.note
     from wallet_transactions w
     join submissions s on s.id = w.submission_id join task_claims c on c.id = s.claim_id
     join task_templates t on t.id = c.template_id join reviews r on r.submission_id = s.id
     where w.user_id = $1 and w.kind = 'credit' order by w.created_at desc limit 500`, [userId]);
  const payouts = await ctx.db.query<PayoutRow>(
    `select p.id, u.name, p.amount_paise, p.status, p.upi_masked, p.requested_at, p.paid_at, pb.name as paid_by
     from payout_requests p join users u on u.id = p.user_id
     left join payout_payments pp on pp.payout_request_id = p.id left join users pb on pb.id = pp.paid_by
     where p.user_id = $1 order by p.requested_at desc limit 200`, [userId]);
  const wallet: WalletEntry[] = entries.map((e) => ({
    id: e.id, title: e.outcome_pct === 100 ? e.title : `${e.title} (${e.outcome_pct}%)`, identityId: e.identity_id, outcome: e.outcome_pct as WalletEntry["outcome"],
    reward: e.reward_paise, credited: e.amount_paise, at: e.created_at.toISOString(), ...(e.note ? { reviewerNote: e.note } : {})
  }));
  return { earned: me.identities.reduce((a, i) => a + i.earned, 0n), entries: wallet, identities: me.identities, payouts: payouts.map((p) => toPayout(p)) };
}
