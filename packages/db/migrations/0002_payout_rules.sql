-- Payout rejection (a payer can refuse a request with a reason, which releases the held amount) and
-- "one UPI ID belongs to one worker".

alter table payout_requests drop constraint payout_requests_status_check;
alter table payout_requests add constraint payout_requests_status_check check (status in ('pending', 'paid', 'rejected'));

alter table payout_requests add column reject_reason text;
alter table payout_requests add column rejected_at timestamptz;
alter table payout_requests add column rejected_by uuid references users(id) on delete restrict;
alter table payout_requests add constraint payout_rejection_complete check (
  (status = 'rejected') = (reject_reason is not null and rejected_at is not null and rejected_by is not null)
);

-- A request may only ever leave "pending"; paid and rejected are final.
create function rr_payout_status_final() returns trigger language plpgsql as $$
begin
  if old.status <> 'pending' and new.status is distinct from old.status then
    raise exception 'a % payout request cannot change status', old.status using errcode = '23514';
  end if;
  return new;
end $$;
create trigger payout_status_final before update on payout_requests for each row execute function rr_payout_status_final();

-- UPI IDs are encrypted, so equality is checked on a keyed hash of the lower-cased ID.
alter table payout_requests add column upi_hash text;
-- No two workers can have the same UPI ID waiting at the same time.
create unique index payout_pending_upi_uq on payout_requests (upi_hash) where status = 'pending' and upi_hash is not null;

-- Set when a payment to the UPI ID is recorded: from then on the ID belongs to that worker until an admin releases it.
create table upi_bindings (
  upi_hash text primary key,
  user_id uuid not null references users(id) on delete restrict,
  bound_at timestamptz not null default now()
);
create index upi_bindings_user_idx on upi_bindings (user_id);
