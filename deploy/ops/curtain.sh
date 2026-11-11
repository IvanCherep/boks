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

# Then the ribbon cards (deploy/ribbon, under test): its own compose file
# travels with the release. The image is built here the first time and again
# whenever its Dockerfile or lockfile changes. One run at a time: a slow one
# is never joined by the next.
ribbon=(docker compose -f compose.yml -f ribbon/compose.ribbon.yml --profile jobs)
rflag="$STATE/ribbon.alert"
if [ -f ribbon/compose.ribbon.yml ]; then
  mkdir -p link-only/ribbon
  recipe=$(cat ribbon/Dockerfile ribbon/package-lock.json | sha256sum | cut -c1-16)
  if [ "$(cat "$STATE/ribbon.image" 2>/dev/null)" != "$recipe" ]; then
    "${ribbon[@]}" build -q ribbon >/dev/null && echo "$recipe" > "$STATE/ribbon.image"
  fi
  if flock -n "$STATE/ribbon.lock" "${ribbon[@]}" run --rm -T ribbon; then
    if [ -f "$rflag" ]; then
      rm -f "$rflag"
      ops/notify.sh "✅ Ленточные превью снова собираются" || true
    fi
  elif [ ! -f "$rflag" ]; then
    date +%s > "$rflag"
    ops/notify.sh "🔴 <b>Ленточные превью не собрались.</b> Лог: docker compose -f compose.yml -f ribbon/compose.ribbon.yml --profile jobs run --rm ribbon" || true
  fi
fi
