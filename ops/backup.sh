#!/usr/bin/env bash
# Backs up the database and the uploaded screenshots. Run it daily (cron, or a scheduled container).
#   DATABASE_URL=postgres://...  UPLOAD_DIR=/data/uploads  BACKUP_DIR=/backups  ./ops/backup.sh
# Keeps the newest KEEP (default 14) of each. Copy BACKUP_DIR somewhere else too (another machine or bucket): a backup on the
# same disk as the site dies with it. Set AFTER_BACKUP to a command that does the copy; it receives the two new file names.
# NOT in the backup, on purpose: SESSION_SECRET and UPI_ENCRYPTION_KEY. Keep those in your password manager. Without the UPI key
# the restored UPI IDs cannot be read.
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL}"
: "${BACKUP_DIR:?set BACKUP_DIR}"
KEEP="${KEEP:-14}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

db_file="$BACKUP_DIR/db-$stamp.dump"
pg_dump --format=custom --no-owner --no-privileges --file="$db_file.partial" "$DATABASE_URL"
mv "$db_file.partial" "$db_file"

files_file=""
if [ -n "${UPLOAD_DIR:-}" ] && [ -d "$UPLOAD_DIR" ]; then
  files_file="$BACKUP_DIR/uploads-$stamp.tar.gz"
  tar -czf "$files_file.partial" -C "$UPLOAD_DIR" .
  mv "$files_file.partial" "$files_file"
fi

# prune: newest KEEP of each kind
for pattern in 'db-*.dump' 'uploads-*.tar.gz'; do
  # `ls` fails when nothing matches (for example no uploads folder yet); that is fine, so it must not stop the script
  { ls -1t "$BACKUP_DIR"/$pattern 2>/dev/null || true; } | tail -n +"$((KEEP + 1))" | xargs -r rm -f --
done

echo "backup.ok db=$db_file ($(du -h "$db_file" | cut -f1)) uploads=${files_file:-none}"
if [ -n "${AFTER_BACKUP:-}" ]; then $AFTER_BACKUP "$db_file" "$files_file"; fi
