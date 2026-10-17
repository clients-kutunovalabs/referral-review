#!/usr/bin/env bash
# Restores a backup into an EMPTY database (and optionally the uploads folder).
#   ./ops/restore.sh backups/db-20260101T020000Z.dump postgres://.../new_database [backups/uploads-....tar.gz /data/uploads]
# It refuses to touch a database that already has tables, so it can never overwrite a live site by accident.
set -euo pipefail

dump="${1:?usage: restore.sh <db dump> <target database url> [uploads.tar.gz target-dir]}"
target="${2:?usage: restore.sh <db dump> <target database url> [uploads.tar.gz target-dir]}"

tables="$(psql "$target" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")"
if [ "$tables" != "0" ]; then
  echo "restore.refused: the target database already has $tables tables. Restore into a new, empty database." >&2
  exit 1
fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$target" "$dump"
echo "restore.ok db"

if [ -n "${3:-}" ] && [ -n "${4:-}" ]; then
  mkdir -p "$4"
  tar -xzf "$3" -C "$4"
  echo "restore.ok uploads -> $4"
fi
