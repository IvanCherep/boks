#!/usr/bin/env bash
# Run a data change (SQL file) on the production database, in one transaction.
#
#   bash deploy/sql.sh <file.sql>           dry run: runs it, prints what it prints, rolls back
#   bash deploy/sql.sh <file.sql> --apply   runs it and commits
#
# For data, not schema: adding boks, fixing a title, hiding a piece. Schema
# changes are migrations (deploy/migrate.sh). This script owns the
# transaction, so the dry run really changes nothing and a failed statement
# undoes the whole file: a bare `begin;` or `commit;` line (what
# scripts/build-catalogue-sql.mjs writes) is dropped, and any other
# transaction control in the file is refused.
#
# Runs as the database owner inside the db container over SSH; nothing secret
# leaves the server. statement_timeout and lock_timeout keep a mistake from
# holding a table the readers need: the file fails instead of waiting.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${BOKS_HOST:-boks-app}

file=${1:-}
[ -n "$file" ] && [ -f "$file" ] || { echo "usage: deploy/sql.sh <file.sql> [--apply]" >&2; exit 2; }
mode=${2:-dry}
case "$mode" in dry|--apply) ;; *) echo "usage: deploy/sql.sh <file.sql> [--apply]" >&2; exit 2 ;; esac

# Transaction statements only: a DO block's own `begin` and `end;` are not one.
if grep -vxiE '(begin|commit);' "$file" | grep -qiE '^[[:space:]]*((begin|commit|rollback|abort|start[[:space:]]+transaction)([[:space:]]+(work|transaction))?[[:space:]]*;|(savepoint|release[[:space:]]+savepoint|rollback[[:space:]]+to)\b)'; then
  echo "sql: $file controls its own transaction beyond a bare begin;/commit; line. Take that out: this script wraps the file in one transaction." >&2
  exit 1
fi

end=rollback
[ "$mode" = --apply ] && end=commit
{
  echo "\\set ON_ERROR_STOP on"
  echo "begin;"
  echo "set local statement_timeout = '60s';"
  echo "set local lock_timeout = '5s';"
  grep -vxiE '(begin|commit);' "$file" || true
  echo
  echo "$end;"
} | ssh -o LogLevel=ERROR "$HOST" "cd /opt/boks && docker compose exec -T db psql -U postgres -h localhost -X -q -v ON_ERROR_STOP=1"

if [ "$mode" = --apply ]; then
  echo "sql: committed $file"
else
  echo "sql: dry run of $file, rolled back. To commit: bash deploy/sql.sh $file --apply"
fi
