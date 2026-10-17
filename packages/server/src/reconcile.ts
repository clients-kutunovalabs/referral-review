import type { Ctx } from "./ctx";

export interface ReconcileReport { ok: boolean; problems: string[]; checkedAt: string }

/**
 * Recomputes the money from first principles and compares it with what was recorded. Run it on a schedule and after any
 * incident; a non-empty `problems` list means stop and investigate before paying anyone. It only reads.
 */
export async function reconcile(ctx: Ctx): Promise<ReconcileReport> {
  const problems: string[] = [];
  const check = async (label: string, sql: string) => {
    const rows = await ctx.db.query<{ id: string }>(sql, [ctx.cfg.workspaceId]);
    for (const r of rows.slice(0, 20)) problems.push(`${label}: ${r.id}`);
    if (rows.length > 20) problems.push(`${label}: ...and ${rows.length - 20} more`);
  };

  await check("credit has no matching review, or the amounts differ",
    `select w.id::text as id from wallet_transactions w left join reviews r on r.submission_id = w.submission_id where w.workspace_id = $1 and w.kind = 'credit' and (r.id is null or r.credited_paise <> w.amount_paise)`);
  await check("review credited an amount but there is no ledger credit",
    `select r.id::text as id from reviews r left join wallet_transactions w on w.submission_id = r.submission_id where r.workspace_id = $1 and r.credited_paise > 0 and w.id is null`);
  await check("review credited the wrong amount for its outcome",
    `select r.id::text as id from reviews r join submissions s on s.id = r.submission_id join task_claims c on c.id = s.claim_id where r.workspace_id = $1 and r.credited_paise <> (c.reward_paise * r.outcome_pct / 100)`);
  await check("paid payout is missing its payment record or ledger debit, or the amounts differ",
    `select p.id::text as id from payout_requests p left join payout_payments pp on pp.payout_request_id = p.id left join wallet_transactions w on w.payout_request_id = p.id
     where p.workspace_id = $1 and p.status = 'paid' and (pp.payout_request_id is null or w.id is null or w.amount_paise <> p.amount_paise)`);
  await check("ledger debit belongs to a payout that is not paid",
    `select w.id::text as id from wallet_transactions w join payout_requests p on p.id = w.payout_request_id where w.workspace_id = $1 and w.kind = 'debit' and p.status <> 'paid'`);
  await check("user balance is negative",
    `select user_id::text as id from wallet_transactions where workspace_id = $1 group by user_id having sum(case when kind = 'credit' then amount_paise else -amount_paise end) < 0`);
  await check("pending payout is more than the user's balance",
    `select p.user_id::text as id from payout_requests p where p.workspace_id = $1 and p.status = 'pending'
     and p.amount_paise > coalesce((select sum(case when kind = 'credit' then amount_paise else -amount_paise end) from wallet_transactions w where w.user_id = p.user_id), 0)`);
  await check("task has more live claims than slots",
    `select t.id::text as id from task_templates t where t.workspace_id = $1 and t.slots_total is not null
     and (select count(*) from task_claims c where c.template_id = t.id and c.status not in ('expired', 'void')) > t.slots_total`);
  await check("claim status and submission status disagree",
    `select c.id::text as id from task_claims c left join submissions s on s.claim_id = c.id where c.workspace_id = $1
     and ((c.status = 'under_review' and (s.id is null or s.status <> 'pending')) or (c.status in ('approved', 'partial', 'rejected') and (s.id is null or s.status <> 'reviewed')))`);

  return { ok: problems.length === 0, problems, checkedAt: ctx.now().toISOString() };
}
