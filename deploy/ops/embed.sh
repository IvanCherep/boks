#!/usr/bin/env bash
# Every 15 minutes from cron: gives newly published boks their vector, then
# their reading facets
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

# Then the reading facets (deploy/embedder/facets.mjs): the mood and author
# group of newly published boks, asked of YandexGPT. Network-bound, but it is
# extra work, so it waits while the server is overloaded (ops/overload.sh).
# Its runs are logged as job `facets`; a failure is reported once, like above.
[ -f flags/busy.on ] && exit 0
[ -f embedder/facets-lib.mjs ] || exit 0
fflag="$STATE/facets.alert"
if docker compose --profile jobs run --rm -T facets; then
  if [ -f "$fflag" ]; then
    rm -f "$fflag"
    ops/notify.sh "✅ Разметка «Что почитать» снова идёт" || true
  fi
else
  if [ ! -f "$fflag" ]; then
    date +%s > "$fflag"
    ops/notify.sh "🔴 <b>Разметка «Что почитать» не прошла.</b> Подробности: background_job_runs, job facets" || true
  fi
fi
