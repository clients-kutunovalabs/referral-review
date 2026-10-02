# Multi-purpose Task Board (beta: internal sales team) — Plan + Repo Scaffold v3

## Context
Product pivot: from review tasks to a general task board. Beta use: our own sales team (salespeople accept tasks, get a task description, optional keywords/features to highlight, and optionally a sales script text). Later it becomes a product for other uses (influencer subscriptions, nursing staff taskboard, etc.) and is integrated into Kutunova as a product with isolated workspaces. Website only (responsive + PWA), no native app. The two HTML prototypes are accurate and are the base.
Repo: `referral-review` (built on branch `claude/vibrant-darwin-k1z0pa`, pulled locally in VS Code).

## Step 0
Built in the cloud session and pushed to the branch; the user pulls it in VS Code. This plan is saved as `docs/PLAN.md`.

## Decisions locked
- Stack: TypeScript end-to-end, Next.js + Node, pnpm monorepo, Postgres.
- Keep the current HTML structure: every screen, class and flow ported 1:1 into React components. Originals copied unchanged to `packages/ui/reference/`.
- Workflow unchanged: worker claims task -> timer -> uploads a screenshot + optional note (no link) -> admin reviews manually (100/75/50/25/0%, mandatory note) -> credit to wallet. Task price is fixed per task template.
- Multi-email: one login, several identities (emails), one wallet. Claim uniqueness = `(identity_id, template_id)`: one email can claim a task once, and the same account may claim the same task from each of its emails. Farming control: optional `max_claims_per_account` per template (NULL = unlimited), plus admin flag when one account claims the same template from many identities.
- Email policy: the system sends NO emails except one one-time verification code (OTP), sent once when an email is registered or added as an identity. No notifications, receipts or marketing emails. OTP: 6 digits, stored hashed, expires in 10 minutes, max 5 wrong attempts, resend cooldown 30s, rate limited per email and per IP.
- Wallet: one total; every ledger row carries `identity_id`; the wallet screen expands to per-email earnings.
- Payout: worker enters the amount and UPI ID each time (nothing else saved). Available = credits - debits - amount held by pending requests. Amount >= configurable minimum and <= available. One pending request at a time. `payment_method` enum (`upi` only now) for later methods.
- Payment: an admin with `payout.mark_paid` transfers manually, then uploads a REQUIRED payment screenshot and marks it paid. Debit row + `payout_payments` row (paid_by, proof_file_key NOT NULL) written in one transaction. No maker-checker.
- Workspace-ready, single workspace now: `workspaces` table and `workspace_id` on every domain table from day one, one seeded default workspace. No tenant-management UI, no RLS yet; RLS + per-workspace roles/branding are added when it becomes a product. This is cheap now and very costly to retrofit.

## Task script: keywords, manual scripts, AI scripts
Per task `text_mode`: `none | keywords | manual_pool | ai_generated` (keywords can combine with any).
- Keywords: shown as "features to highlight"; server matches them in the worker's note (whole word, case-insensitive) as an aid to the reviewer, not auto-approval.
- Manual pool (`task_texts`): admin adds 1..N scripts. Assignment is a balanced random bag: for N scripts and M claimers each script is used floor(M/N) or ceil(M/N) times, order random. Persisted bag per template, drawn under a row lock inside the claim transaction (no two workers race to the same slot); when the bag empties it is reshuffled. Example: 10 scripts, 100 workers = each script given to 10 workers in random order.
- AI-generated: a new script per claim. Only when chosen. Server-enforced input allow-list: task title, task description, keywords, plus the generator fields. No worker name, email, phone or wallet data ever reaches the AI. Publish is blocked until the required fields are filled: description, at least 1 keyword, tone, language, min/max length, script style (e.g. cold message / call script / email). Generated text is stored (`claim_task_texts`) so the worker sees the same text on reopen, and it is audit-logged.
- The assigned text is shown to the worker with a copy button.
- Site link: `site_url` per task (validated https), shown on the task page (where the work happens).

## Help and support tickets
- Users: a Help tab (and a Help button on the Payout page) opens two lists, Open and Closed (no status on rows). "Create ticket" opens an overlay: title, description, one optional image. Tapping a ticket opens a chat view (customer messages, admin replies, system lines for assign/resolve).
- Admins with `ticket.manage`: Support list (Open/Closed, "Needs reply"), assign a ticket to a team member, reply, and Mark resolved (confirm). When resolved the customer can still read the chat but the composer is gone (enforced on the server too); a new ticket is needed for further help. Nothing is emailed: replies are read in the app.
- Data model: `tickets`(workspace_id, number, user_id, title, status, assignee_id, created_at, updated_at), `ticket_messages`(ticket_id, sender_type customer|admin|system, sender_id, body, attachment_key, created_at). Server rejects customer messages on closed tickets. Every assign/resolve is audit-logged.

## Records are never lost (active, suspended or deleted)
- `users.status` = `active | suspended | deleted`; delete is soft. PII may be anonymised on request; the user row, identities' ids, claims, submissions, reviews, ledger, payout requests, payments and audit log stay.
- All financial FKs `ON DELETE RESTRICT`; triggers reject UPDATE/DELETE on `wallet_transactions`, `payout_payments`, `admin_audit_log`.
- Suspended/deleted users cannot log in, claim or request payouts. Their pending credits and payouts stay visible to admins and are resolved by a recorded admin decision.

## Money safety
- `bigint` paise everywhere; `Money` value object in `packages/money`; ESLint bans `number` arithmetic in money code; APIs send money as strings.
- Outcome maths: `floor(reward_paise * pct / 100)`, pct in {100,75,50,25,0}, one function, property-tested.
- Append-only ledger; balance is always computed (per identity and total); no balance column.
- Double-pay guards: unique credit per `submission_id`; unique payment per `payout_request_id`; payout request and debit checked under a row lock against available balance.
- Reconciliation script recomputes every wallet from the ledger and checks credits vs approved outcomes and debits vs recorded payments; fails loudly on mismatch.

## Design system + ui-hub
- First build step, before any screen: extract tokens from the HTML `:root` (surface 0/1/2, text primary/secondary/muted, border, semantic teal/amber/coral/green + -bg, radii, type sizes, spacing) into `packages/ui/tokens` as CSS variables + typed TS. Fonts are tokens (`--font-body`, `--font-heading`), starting from the HTML stack, improved to a chosen pair once you approve one. Tokens are themeable per workspace later.
- `packages/ui` is the only place UI code lives: primitives + user and admin screen components.
- `apps/ui-hub` (dev/staging only): `/` user screens (phone frame), `/admin` admin screens, `/design-system` tokens, typography, colours, every primitive in every state. Mock-data fixtures, real components.
- `apps/web` (user site + `/admin`) imports the same `@rr/ui`. No other app defines its own styles/components; CI lint bans it; Playwright visual-regression on ui-hub.
- Production: ui-hub is not built or deployed; design system is internal only (default: removed from production, or behind admin auth with `design.view`).

## Palette (decided)
Green-tinted neutrals + ONE brand colour (deep emerald `--brand`: actions, active, success, money) + ONE accent (saffron `--accent`: reward highlights, processing, time pressure) + one functional red (errors, rejected). Contrast is enforced by tests (4.5:1). Layout: 12px above the top bar and 24px below the bottom nav on every screen (`--safe-top`, `--safe-bottom`, also honouring device safe areas).

## Admin roles and permissions
Tables: `admin_members, roles, role_permissions, member_roles`. Permissions: `task.manage`, `task.assign`, `review.decide`, `payout.mark_paid`, `user.manage`, `role.manage`, `task_text.manage`, `ticket.manage`, `design.view`. Owner has all, cannot be removed; members can hold several roles; every route checks the DB per request; every admin action audit-logged.

## Security (realistic)
Frontend code can't be made uncopyable. Protection = server-side authz and logic, no secrets/prices/rules in client, CSP and security headers, minified bundles without public source maps, CSRF, rate limiting, uploads validated and served from a separate domain, UPI encrypted at rest and masked outside the payout screen, dependency audit in CI. Sales screenshots may contain customer data: private bucket, signed short-lived URLs, retention policy.

## Repo structure
```
referral-review/
  package.json pnpm-workspace.yaml turbo.json tsconfig.base.json
  .env.example .gitignore .editorconfig eslint.config.js README.md
  docker-compose.yml  .github/workflows/ci.yml
  apps/
    web/        # user site + /admin, imports @rr/ui only
    ui-hub/     # dev/staging: /, /admin, /design-system
    worker/     # claim-expiry sweeper, reconciliation job
  packages/
    ui/         # tokens/, primitives/, screens/user, screens/admin, reference/ (original HTML)
    db/         # Drizzle schema, migrations, triggers, seed
    money/      # Money type, outcome calc, tests
    core/       # claims, task-texts (bag), ledger, payouts, rbac, identities
    auth/       # Authgate adapter, sessions, CSRF
    storage/    # object storage, upload validation, thumbnails
    ai/         # script generator, typed input allow-list
    config/     # eslint, tsconfig, Zod env schema
  docs/ ARCHITECTURE.md MONEY.md SECURITY.md RUNBOOK.md POLICY.md
  scripts/ backup, restore-test, reconcile
```

## Data model additions
`workspaces`; `users`(status), `identities`(user_id, email unique, verified_at), `email_otps`(email, code_hash, expires_at, attempts); `task_templates` += `workspace_id, site_url, text_mode, keywords[], ai_config jsonb, max_claims_per_account`; `task_claims` unique `(identity_id, template_id)`; `task_texts`, `template_text_bag`, `claim_task_texts`; `submissions` += `keywords_matched`; `payout_requests`(amount, payment_method, upi encrypted); `payout_payments`(payout_request_id unique, paid_by, proof_file_key NOT NULL); RBAC tables above.

## Build order (each step waits for your go-ahead)
UI first, backend after the UI flow is signed off:
1. Repo structure (scaffold, empty packages, configs, CI) -> 2. Design system (tokens, primitives, `/design-system` in ui-hub) -> 3. Admin and user flow UI in ui-hub from the HTML (mock data, every state) -> UI sign-off gate -> 4. DB schema + money package + ledger tests -> 5. auth/RBAC -> 6. core loop (claim, text bag, submit) -> 7. admin actions -> 8. payouts -> 9. hardening.
Because the backend comes last, the UI defines typed service interfaces and mock fixtures in `packages/core` contracts (Zod schemas) so the backend later implements exactly what the UI consumed.

## Verification (scaffold)
`pnpm install && pnpm lint && pnpm typecheck && pnpm test` pass; `pnpm --filter ui-hub dev` serves `/`, `/admin`, `/design-system`; production Docker target builds without ui-hub; `docker compose up` boots Postgres and migrations apply. Later: 50 concurrent claims on a 10-slot task give exactly 10; 100 claims over 10 scripts give 10 each.

## Time limit and claim rules (task template)
- Time limit is entered in hours (decimals allowed) and stored as minutes; blank = unlimited (`timer_minutes` NULL, no expiry sweep for that claim).
- Claim rules: an account may hold unlimited emails; each email (identity) may claim a given task once. Enforced by the DB unique constraint `(identity_id, template_id)`. `max_claims_per_account` stays as an optional extra cap (NULL = none).
