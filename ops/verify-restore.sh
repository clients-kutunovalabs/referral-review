#!/usr/bin/env bash
# Proves a backup is usable: restores the newest dump into a scratch database, compares what is in it with the live database,
# and runs the money check (reconcile) on the copy. Run it after setting backups up, then monthly.
#   DATABASE_URL=postgres://.../live  BACKUP_DIR=/backups  ./ops/verify-restore.sh
# Needs permission to create a database next to the live one (RESTORE_ADMIN_URL, default: same server, database "postgres").
# RECONCILE_CMD runs the money check against $RESTORE_URL (default: pnpm reconcile).
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL}"
: "${BACKUP_DIR:?set BACKUP_DIR}"
latest="$(ls -1t "$BACKUP_DIR"/db-*.dump 2>/dev/null | head -n 1 || true)"
[ -n "$latest" ] || { echo "verify.FAILED: no db-*.dump in $BACKUP_DIR" >&2; exit 1; }

base="${DATABASE_URL%%\?*}"; query=""; [[ "$DATABASE_URL" == *\?* ]] && query="?${DATABASE_URL#*\?}"
admin="${RESTORE_ADMIN_URL:-${base%/*}/postgres$query}"
scratch="rr_restore_check_$$"
RESTORE_URL="${base%/*}/$scratch$query"
cleanup() { psql "$admin" -qc "drop database if exists $scratch" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql "$admin" -qc "create database $scratch"
./ops/restore.sh "$latest" "$RESTORE_URL" >/dev/null

counts="select 'users', count(*) from users union all select 'identities', count(*) from identities union all select 'submissions', count(*) from submissions
 union all select 'reviews', count(*) from reviews union all select 'payout_requests', count(*) from payout_requests union all select 'payout_payments', count(*) from payout_payments
 union all select 'wallet_credits_paise', coalesce(sum(amount_paise),0) from wallet_transactions where kind='credit'
 union all select 'wallet_debits_paise', coalesce(sum(amount_paise),0) from wallet_transactions where kind='debit' union all select 'files', count(*) from files
 union all select 'audit_log', count(*) from admin_audit_log order by 1"
live="$(psql "$DATABASE_URL" -At -c "$counts")"; copy="$(psql "$RESTORE_URL" -At -c "$counts")"
if [ "$live" != "$copy" ]; then
  # The live site keeps working after the backup was taken, so small differences are normal; show them and let a human judge.
  echo "verify.differences (live vs restored copy; expected only if the site was used since the backup):"
  diff <(echo "$live") <(echo "$copy") || true
fi

DATABASE_URL="$RESTORE_URL" ${RECONCILE_CMD:-pnpm reconcile} | tail -n 1 | tee /dev/stderr | grep -q "reconcile.ok" \
  || { echo "verify.FAILED: the money check failed on the restored copy" >&2; exit 1; }
echo "verify.ok backup=$latest"
