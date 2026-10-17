-- referral-review: initial schema.
-- Money is bigint paise. Records are never hard-deleted: financial foreign keys are ON DELETE RESTRICT and the
-- ledger, payments, reviews and audit log are append-only (enforced by triggers, so a bug in the app cannot rewrite history).
-- Every domain table carries workspace_id; one default workspace is seeded below.

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
insert into workspaces (id, name) values ('00000000-0000-0000-0000-000000000001', 'Default workspace');

create table settings (
  workspace_id uuid not null references workspaces(id) on delete restrict,
  key text not null,
  value text not null,
  primary key (workspace_id, key)
);
-- minimum payout, in paise (Rs 10)
insert into settings (workspace_id, key, value) values ('00000000-0000-0000-0000-000000000001', 'min_payout_paise', '1000');

-- ---------- people ----------

create table users (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete restrict,
  name text not null,
  phone text,
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  created_at timestamptz not null default now()
);
create index users_workspace_status_idx on users (workspace_id, status);

create table identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete restrict,
  user_id uuid not null references users(id) on delete restrict,
  email text not null,
  is_primary boolean not null default false,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index identities_email_uq on identities (workspace_id, lower(email));
create unique index identities_one_primary_uq on identities (user_id) where is_primary;
create index identities_user_idx on identities (user_id);

-- ---------- auth (built-in provider; an external provider such as Authgate replaces credentials and codes) ----------

create table auth_credentials (
  user_id uuid primary key references users(id) on delete cascade,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  ip text,
  user_agent text
);
create index sessions_user_idx on sessions (user_id);

-- one live code per key ("signup:email", "reset:email", "identity:userId:email"); only a hash is stored
create table auth_codes (
  key text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  sent_at timestamptz not null default now(),
  profile jsonb not null default '{}'::jsonb   -- sign-up details (name, phone), kept until the code is verified
);

-- single-use proof that a code was verified; good for the next step only
create table auth_tickets (
  token_hash text primary key,
  email text not null,
  purpose text not null check (purpose in ('signup', 'reset')),
  profile jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null
);

create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

-- ---------- admin roles ----------

create table roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete restrict,
  name text not null,
  is_owner boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index roles_name_uq on roles (workspace_id, lower(name));
create unique index roles_one_owner_uq on roles (workspace_id) where is_owner;

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission text not null check (permission in (
    'task.manage', 'task.assign', 'task_text.manage', 'review.decide', 'payout.mark_paid',
    'user.manage', 'ticket.manage', 'role.manage', 'design.view')),
  primary key (role_id, permission)
);

create table admin_members (
  user_id uuid primary key references users(id) on delete restrict,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  is_owner boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index admin_members_one_owner_uq on admin_members (workspace_id) where is_owner;

create table member_roles (
  user_id uuid not null references admin_members(user_id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  primary key (user_id, role_id)
);

insert into roles (id, workspace_id, name, is_owner) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Owner', true);
insert into role_permissions (role_id, permission)
  select '00000000-0000-0000-0000-0000000000a1', p from unnest(array[
    'task.manage', 'task.assign', 'task_text.manage', 'review.decide', 'payout.mark_paid',
    'user.manage', 'ticket.manage', 'role.manage', 'design.view']) as p;

-- ---------- files ----------

create table files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete restrict,
  owner_user_id uuid not null references users(id) on delete restrict,
  kind text not null check (kind in ('proof', 'payment_proof', 'ticket_attachment')),
  storage_key text not null unique,
  content_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);
create index files_owner_idx on files (owner_user_id);

-- ---------- tasks ----------

create table task_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete restrict,
  title text not null check (length(trim(title)) > 0),
  description text not null,
  site_url text not null check (site_url ~ '^https://'),
  reward_paise bigint not null check (reward_paise > 0),
  slots_total integer check (slots_total > 0),            -- null = unlimited
  timer_minutes integer check (timer_minutes > 0),        -- null = unlimited
  active_until timestamptz,                               -- null = no end date
  status text not null default 'active' check (status in ('active', 'paused', 'removed')),
  keywords text[] not null default '{}',
  text_mode text not null default 'none' check (text_mode in ('none', 'keywords', 'manual_pool', 'ai_generated')),
  ai_config jsonb,
  max_claims_per_account integer check (max_claims_per_account > 0),
  created_by uuid references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index task_templates_workspace_status_idx on task_templates (workspace_id, status);

create table task_texts (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,                 -- insertion order, for stable display
  workspace_id uuid not null references workspaces(id) on delete restrict,
  template_id uuid not null references task_templates(id) on delete restrict,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index task_texts_template_idx on task_texts (template_id);

-- the persisted "balanced random bag": scripts still to hand out, in order
create table template_text_bag (
  template_id uuid not null references task_templates(id) on delete restrict,
  position integer not null,
  text_id uuid not null references task_texts(id) on delete restrict,
  primary key (template_id, position)
);

create table task_claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete restrict,
  template_id uuid not null references task_templates(id) on delete restrict,
  user_id uuid not null references users(id) on delete restrict,
  identity_id uuid not null references identities(id) on delete restrict,
  status text not null default 'claimed' check (status in ('claimed', 'under_review', 'approved', 'partial', 'rejected', 'expired', 'void')),
  reward_paise bigint not null check (reward_paise > 0),  -- price at claim time, so later edits never change what was promised
  claimed_at timestamptz not null default now(),
  expires_at timestamptz,                                 -- null = no time limit
  submitted_at timestamptz,
  ended_at timestamptz,
  assigned_text text,
  text_source text check (text_source in ('pool', 'ai')),
  text_status text not null default 'none' check (text_status in ('none', 'ready', 'pending', 'failed'))
);
-- one live claim per (email, task); an expired or voided claim frees the email to claim again
create unique index task_claims_live_uq on task_claims (identity_id, template_id) where status not in ('expired', 'void');
create index task_claims_user_idx on task_claims (user_id, status);
create index task_claims_template_idx on task_claims (template_id, status);
create index task_claims_expiry_idx on task_claims (expires_at) where status = 'claimed' and expires_at is not null;

create table submissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete restrict,
  claim_id uuid not null unique references task_claims(id) on delete restrict,
  file_id uuid not null references files(id) on delete restrict,
  note text,
  keywords_matched text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'reviewed')),
  submitted_at timestamptz not null default now()
);
create index submissions_pending_idx on submissions (workspace_id, submitted_at) where status = 'pending';

create table reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete restrict,
  submission_id uuid not null unique references submissions(id) on delete restrict,
  reviewer_id uuid not null references users(id) on delete restrict,
  outcome_pct integer not null check (outcome_pct in (100, 75, 50, 25, 0)),
  note text not null check (length(trim(note)) > 0),
  credited_paise bigint not null check (credited_paise >= 0),
  created_at timestamptz not null default now()
);

-- ---------- money ----------

create table payout_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete restrict,
  user_id uuid not null references users(id) on delete restrict,
  amount_paise bigint not null check (amount_paise > 0),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  payment_method text not null default 'upi' check (payment_method in ('upi')),
  upi_encrypted text not null,
  upi_masked text not null,
  requested_at timestamptz not null default now(),
  paid_at timestamptz
);
-- one request at a time per user
create unique index payout_one_pending_uq on payout_requests (user_id) where status = 'pending';
create index payout_status_idx on payout_requests (workspace_id, status, requested_at);

create table payout_payments (
  payout_request_id uuid primary key references payout_requests(id) on delete restrict,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  paid_by uuid not null references users(id) on delete restrict,
  proof_file_id uuid not null references files(id) on delete restrict,
  paid_at timestamptz not null default now()
);

-- append-only ledger. Balance is always computed from it; there is no balance column.
create table wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete restrict,
  user_id uuid not null references users(id) on delete restrict,
  identity_id uuid not null references identities(id) on delete restrict,
  kind text not null check (kind in ('credit', 'debit')),
  amount_paise bigint not null check (amount_paise > 0),
  submission_id uuid unique references submissions(id) on delete restrict,        -- one credit per submission
  payout_request_id uuid unique references payout_requests(id) on delete restrict, -- one debit per payout
  created_at timestamptz not null default now(),
  check (
    (kind = 'credit' and submission_id is not null and payout_request_id is null) or
    (kind = 'debit' and payout_request_id is not null and submission_id is null)
  )
);
create index wallet_transactions_user_idx on wallet_transactions (user_id, created_at);

-- ---------- support ----------

create sequence ticket_number_seq start 1001;

create table tickets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete restrict,
  number integer not null unique default nextval('ticket_number_seq'),
  user_id uuid not null references users(id) on delete restrict,
  title text not null check (length(trim(title)) > 0),
  status text not null default 'open' check (status in ('open', 'closed')),
  assignee_id uuid references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index tickets_user_idx on tickets (user_id);
create index tickets_status_idx on tickets (workspace_id, status, updated_at);

create table ticket_messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,                 -- conversation order, stable even for messages stamped in the same millisecond
  ticket_id uuid not null references tickets(id) on delete restrict,
  sender_type text not null check (sender_type in ('customer', 'admin', 'system')),
  sender_id uuid references users(id) on delete restrict,
  sender_name text not null,
  body text not null check (length(trim(body)) > 0),
  attachment_file_id uuid references files(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index ticket_messages_ticket_idx on ticket_messages (ticket_id, seq);

-- ---------- audit ----------

create table admin_audit_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  actor_user_id uuid references users(id) on delete restrict,  -- null for system actions (expiry sweeper, AI script generation)
  action text not null,
  target_type text,
  target_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_log_created_idx on admin_audit_log (created_at);

-- ---------- integrity triggers ----------

create function rr_reject_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% on % is not allowed: the table is append-only', tg_op, tg_table_name using errcode = 'restrict_violation';
end $$;

create trigger wallet_transactions_append_only before update or delete on wallet_transactions for each row execute function rr_reject_mutation();
create trigger wallet_transactions_no_truncate before truncate on wallet_transactions for each statement execute function rr_reject_mutation();
create trigger payout_payments_append_only before update or delete on payout_payments for each row execute function rr_reject_mutation();
create trigger payout_payments_no_truncate before truncate on payout_payments for each statement execute function rr_reject_mutation();
create trigger reviews_append_only before update or delete on reviews for each row execute function rr_reject_mutation();
create trigger reviews_no_truncate before truncate on reviews for each statement execute function rr_reject_mutation();
create trigger admin_audit_log_append_only before update or delete on admin_audit_log for each row execute function rr_reject_mutation();
create trigger admin_audit_log_no_truncate before truncate on admin_audit_log for each statement execute function rr_reject_mutation();

-- Defence in depth: a debit may never exceed what the user has earned and not yet been paid.
-- The user row is locked first so two debits for the same user cannot both pass the check.
create function rr_check_debit() returns trigger language plpgsql as $$
declare balance bigint;
begin
  if new.kind <> 'debit' then return new; end if;
  perform 1 from users where id = new.user_id for update;
  select coalesce(sum(case when kind = 'credit' then amount_paise else -amount_paise end), 0) into balance
    from wallet_transactions where user_id = new.user_id;
  if balance < new.amount_paise then
    raise exception 'debit of % exceeds balance of %', new.amount_paise, balance using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger wallet_transactions_debit_check before insert on wallet_transactions for each row execute function rr_check_debit();
