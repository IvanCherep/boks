#!/usr/bin/env bash
# Send one message to the team Telegram group through the Cloudflare relay
# (deploy/telegram-relay). Usage: notify.sh "<html text>" [silent]
set -euo pipefail
cd "$(dirname "$0")/.."
TG_RELAY_KEY=$(grep -E '^TG_RELAY_KEY=' .env | cut -d= -f2-)
RELAY_URL=$(grep -E '^TG_RELAY_URL=' .env | cut -d= -f2- || true)
RELAY_URL=${RELAY_URL:-https://boks-telegram.tryboks.workers.dev/send}
silent=${2:-}
payload=$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1], "silent": sys.argv[2] == "silent"}))' "$1" "$silent")
curl -fsS -m 20 --retry 2 --retry-delay 5 -X POST "$RELAY_URL" \
  -H "Authorization: Bearer $TG_RELAY_KEY" -H "Content-Type: application/json" \
  -d "$payload" >/dev/null
