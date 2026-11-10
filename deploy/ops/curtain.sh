#!/usr/bin/env bash
# Every 15 minutes from cron: gives newly published boks their curtain loop
# (deploy/curtain). A failure is reported once to Telegram, and its recovery
# once, never on every run.
set -uo pipefail
cd "$(dirname "$0")/.."
STATE=/var/lib/boks-ops
mkdir -p "$STATE" link-only/curtain
flag="$STATE/curtain.alert"

if docker compose --profile jobs run --rm -T curtain; then
  if [ -f "$flag" ]; then
    rm -f "$flag"
    ops/notify.sh "✅ Шторки для превью снова собираются" || true
  fi
else
  if [ ! -f "$flag" ]; then
    date +%s > "$flag"
    ops/notify.sh "🔴 <b>Шторки для превью не собрались.</b> Лог: docker compose --profile jobs run --rm curtain" || true
  fi
fi
