-- Fixes from the October 2026 audit.

-- 1. One claim per email per task, ever. An expired or voided claim no longer frees the email to claim again.
do $$
begin
  if exists (select 1 from task_claims group by identity_id, template_id having count(*) > 1) then
    raise exception 'Migration 0003 stopped: some emails claimed the same task more than once. See docs/RUNBOOK.md ("Duplicate claims") before applying it.';
  end if;
end $$;
drop index task_claims_live_uq;
create unique index task_claims_once_uq on task_claims (identity_id, template_id);

-- 2. "One UPI ID per worker" is postponed: workers type a UPI ID each time and nothing is checked against other accounts.
-- upi_bindings and payout_requests.upi_hash stay (unused) so the rule can come back without another schema change.
drop index payout_pending_upi_uq;

-- 3. Permissions with no feature behind them are removed.
delete from role_permissions where permission in ('task.assign', 'design.view');
alter table role_permissions drop constraint role_permissions_permission_check;
alter table role_permissions add constraint role_permissions_permission_check check (permission in (
  'task.manage', 'task_text.manage', 'review.decide', 'payout.mark_paid', 'user.manage', 'ticket.manage', 'role.manage'));

-- 4. Deleted accounts keep every record, but their emails are released 30 days after deletion so the address can sign up again.
-- A released identity keeps its id (ledger, claims and reviews still point at it) and its email text; it is only ignored by
-- sign-in, sign-up and add-email lookups, and no longer blocks the address.
alter table users add column deleted_at timestamptz;
-- accounts deleted before this column existed: count from the moment of the upgrade (the safe side of 30 days)
update users set deleted_at = now() where status = 'deleted';
alter table users add constraint users_deleted_at_check check ((status = 'deleted') = (deleted_at is not null));
alter table identities add column released_at timestamptz;
drop index identities_email_uq;
create unique index identities_email_uq on identities (workspace_id, lower(email)) where released_at is null;
