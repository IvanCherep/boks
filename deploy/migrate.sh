#!/usr/bin/env bash
# Database migrations for the self-hosted Postgres, through an SSH tunnel.
#
#   bash deploy/migrate.sh            dry run: lists the migrations production does not have
#   bash deploy/migrate.sh --apply    applies them
#
# Apply migrations before releasing code that needs them, and only ones the code
# already live also survives: tabs open on the old client keep calling for a while.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${BOKS_HOST:-boks-app}
PORT=55432
# The password is read from the server's .env over SSH, used for this run only.
PW=$(ssh -o LogLevel=ERROR "$HOST" 'sed -n "s/^POSTGRES_PASSWORD=//p" /opt/boks/.env')
[ -n "$PW" ] || { echo "Cannot read POSTGRES_PASSWORD from $HOST:/opt/boks/.env" >&2; exit 1; }

ssh -o LogLevel=ERROR -o ExitOnForwardFailure=yes -fN -L "$PORT:127.0.0.1:5432" "$HOST"
trap 'pkill -f "^ssh .*-L $PORT:127.0.0.1:5432" || true' EXIT
URL="postgresql://postgres:$PW@127.0.0.1:$PORT/postgres?sslmode=disable"

if [ "${1:-}" = --apply ]; then
  npx supabase db push --remote "$URL" --yes
else
  npx supabase db push --remote "$URL" --dry-run
  echo "Dry run. To apply: bash deploy/migrate.sh --apply"
fi
