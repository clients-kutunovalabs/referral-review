# Runbook

## Daily
- `GET /api/health` is green. The worker is running (look for a recent `claims.expired` or `housekeeping` line in its log; `worker.start` shows it began).
- Back up the database and the upload volume.

## Backups and restore
Run **daily**: `DATABASE_URL=... UPLOAD_DIR=/data/uploads BACKUP_DIR=/backups ./ops/backup.sh` (needs `pg_dump` 14 or newer). It writes a database dump and a tar of the uploads folder, keeps the newest 14 of each (`KEEP`), and prints `backup.ok`. A backup on the same disk as the site dies with it: set `AFTER_BACKUP` to a command that copies the two new files elsewhere (another machine or a bucket).
**Prove it works** now and then monthly: `./ops/verify-restore.sh` restores the newest dump into a scratch database, compares record counts and money totals with the live database, runs the money check on the copy, and drops it. It prints `verify.ok`. Differences in counts are normal if the site was used since the backup.
**Restore for real:** create a new empty database, then `./ops/restore.sh <dump> <new database url> [uploads.tar.gz /data/uploads]`. It refuses a database that already has tables. Point the site at the new database only after `pnpm reconcile` says `reconcile.ok` on it.
**Not in the backup, on purpose:** `SESSION_SECRET` and `UPI_ENCRYPTION_KEY`. Keep them in a password manager. Without the UPI key the restored UPI IDs cannot be read.

Backup files are created readable by their owner only (`umask 077`). On a machine other people can log in to, put the database password in a `~/.pgpass` file (mode 600) instead of `DATABASE_URL`, because a password on the command line is visible to them while `pg_dump` runs.

## An alert arrives
- **"Money records disagree"**: stop marking payouts as paid. Follow "Money reconciliation" below.
- **"Background job failed"**: look at the worker log line `job.failed` for the job name. If `expire` keeps failing, claims are not freeing their slots.
- **"Unexpected server error"**: find the `api.unexpected_error` line in the site log at that time.
- **Uptime monitor says the worker is down** (`/api/health?strict=1` returns 503 with `"worker":{"state":"stale"}` or `"never"`): the worker container is not running. Start it (`docker compose up -d worker`). Timed-out claims are freed on the next run; nothing is lost.

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

## Checking a UPI ID before paying
Paste the ID into your UPI app: it shows the account holder's name before you send. If it is invalid or the name does not fit the worker, reject the request with a reason ("UPI ID is invalid, check it and request again"). The worker sees it and the amount is free again.

## Duplicate claims (migration 0003 stopped)
Migration 0003 makes "one claim per email per task" permanent. If a database already has an email that claimed the same task twice (possible before 0003, after an expiry), the migration stops and changes nothing. Find them with
`select identity_id, template_id, count(*) from task_claims group by 1, 2 having count(*) > 1;`
and do not delete or edit those claims yourself (records are never deleted, and claims with a submission are tied to reviews and the ledger). Send the list to the developer: the fix is a one-off migration that moves the older, ended claim of each pair into a history table, keeping it on record, after which 0003 applies. A site that launches on 0003 can never get into this state.

## A payout was paid twice or in the wrong amount
Money already left your bank, so this is a bookkeeping fix: do not delete anything. Record it as a ticket reply to the worker, and adjust by the worker's next payout (a manual note in support). The ledger shows exactly what the site believed.

## Locked-out admin
- Anyone: "Forgot password" on `/admin` (needs access to the owner email).
- Lost owner email: run `pnpm db:seed` with a new `OWNER_EMAIL` only creates an owner if none exists. Otherwise fix it in the database: insert an `admin_members` row with `is_owner = true` for the user, and add them to the Owner role.

## Suspending someone
Admin, Users and roles, the person, Suspend. They are signed out at once and cannot log in, claim or ask for payouts. Their credits and requests stay visible. A payout they already requested cannot be paid while they are suspended: reject it (the amount is released) or reinstate them first. Only the owner can suspend or delete a member of the admin team.

## Uploads and deleted accounts (automatic)
The worker removes uploads older than 30 days that no submission, payment or ticket uses, once a month (`docker run ... tasks-worker purge-files` runs it now). Once a day it also deletes the image bytes of work proofs reviewed 30+ days ago and ticket images of tickets resolved 30+ days ago (`tasks-worker purge-screenshots` runs it now); the file row stays with `purged_at` set, the API answers 410 for it, and every deletion is in the audit log (`files.retention_purge`). Payment screenshots are never removed. Emails of accounts deleted at least 30 days ago are released every hour, so the address can sign up again; the old account's records stay.

## Rotating secrets
- `SESSION_SECRET`: changing it signs out nobody (sessions are looked up by hash) but invalidates open CSRF tokens and any pending one-time codes. Do it at a quiet time.
- `UPI_ENCRYPTION_KEY`: cannot be changed yet (needs a re-encryption script). Keep it safe.

## Releases
Migrations run at start-up (`AUTO_MIGRATE=1`), guarded by a lock. They only ever add: `migrations/*.sql` files are numbered and never edited after release. Run `pnpm --filter @rr/db embed` after adding one (CI fails if you forget).
