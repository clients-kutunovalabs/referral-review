# Runbook

## Daily
- `GET /api/health` is green. The worker is running (look for a recent `claims.expired` or `housekeeping` line in its log; `worker.start` shows it began).
- Back up the database and the upload volume.

## Backups and restore
- Back up PostgreSQL at least daily (`pg_dump -Fc`) and keep several days. Back up the upload volume with it: a restored database without its screenshots has proofs that open to nothing.
- **Back up `UPI_ENCRYPTION_KEY` separately from the database.** Without it, stored UPI IDs cannot be read.
- Try a restore into an empty database now and then: `pg_restore -d <new db> <dump>`, start the app against it, run `pnpm reconcile`.

## Claims that never expire
Symptom: tasks show slots taken by claims whose timer ran out. Cause: the worker is not running. Start it (`pnpm worker`, or the `worker` container). It catches up on its first minute.

## Money reconciliation (`pnpm reconcile`)
Recomputes everything from the ledger and checks it against reviews, payouts and payments. It runs in the worker every 6 hours and prints `reconcile.ok`.

If it prints `reconcile.PROBLEMS`, **stop marking payouts as paid** until you know why:
1. Read the listed rows. Each line names the kind of mismatch and a row id.
2. Query the rows (`wallet_transactions`, `reviews`, `payout_requests`, `payout_payments`) and the `admin_audit_log` around that time.
3. The ledger, reviews, payments and audit log cannot be edited, so any mismatch means a record is missing or something bypassed the app. Correct it with a new, explained record, never by editing history.

## A payout request has a bad UPI ID, or the bank refuses it
Open it in Payouts, choose "Reject the request" and write the reason. The worker sees it, the amount is free again and they can ask again. Do not mark it paid. Rejected is final, so the worker makes a new request.

## "This UPI ID can't be used" (a worker writes in)
The ID is either waiting on another worker's request, or was paid to another worker before. If the worker lost their old account and the ID is theirs: confirm who they are through the ticket, then Payouts, "Release their UPI ID". If another request is still waiting on it, reject that one first. Each release is logged with your name.

## A payout was paid twice or in the wrong amount
Money already left your bank, so this is a bookkeeping fix: do not delete anything. Record it as a ticket reply to the worker, and adjust by the worker's next payout (a manual note in support). The ledger shows exactly what the site believed.

## Locked-out admin
- Anyone: "Forgot password" on `/admin` (needs access to the owner email).
- Lost owner email: run `pnpm db:seed` with a new `OWNER_EMAIL` only creates an owner if none exists. Otherwise fix it in the database: insert an `admin_members` row with `is_owner = true` for the user, and add them to the Owner role.

## Suspending someone
Admin, Users and roles, the person, Suspend. They are signed out at once and cannot log in, claim or ask for payouts. Their credits and requests stay visible; a payout they already requested can still be paid.

## Rotating secrets
- `SESSION_SECRET`: changing it signs out nobody (sessions are looked up by hash) but invalidates open CSRF tokens and any pending one-time codes. Do it at a quiet time.
- `UPI_ENCRYPTION_KEY`: cannot be changed yet (needs a re-encryption script). Keep it safe.

## Releases
Migrations run at start-up (`AUTO_MIGRATE=1`), guarded by a lock. They only ever add: `migrations/*.sql` files are numbered and never edited after release. Run `pnpm --filter @rr/db embed` after adding one (CI fails if you forget).
