#!/usr/bin/env bash
# Every 15 minutes from cron: gives newly published boks their vector
# (deploy/embedder). Each run is logged in background_job_runs and shown in
# the admin console; a failure is also reported once to Telegram, and its
# recovery once, never on every run.
set -uo pipefail
cd "$(dirname "$0")/.."
STATE=/var/lib/boks-ops
mkdir -p "$STATE"
flag="$STATE/embedder.alert"

if docker compose --profile jobs run --rm -T embedder; then
  if [ -f "$flag" ]; then
    rm -f "$flag"
    ops/notify.sh "✅ Эмбеддинги снова считаются" || true
  fi
else
  if [ ! -f "$flag" ]; then
    date +%s > "$flag"
    ops/notify.sh "🔴 <b>Эмбеддинги не посчитались.</b> Подробности: Студия → Контент → Фоновые задачи" || true
  fi
fi
