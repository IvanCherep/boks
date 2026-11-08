#!/usr/bin/env bash
# Put a release live with no downtime. Runs on the server; deploy/release.sh
# calls it after uploading, and it is also the rollback:
#
#   ops/switch.sh <release-id>      e.g. 20261108-203000-51d1a3a
#
# The app runs as two copies, app-blue and app-green, both behind Caddy. One
# copy at a time: point its slot at the release, recreate it (the old process
# reports 503 on /__health, Caddy stops sending it requests, it finishes the ones
# it has and exits), wait until the new one is healthy, then the other copy.
# While one copy restarts, the other answers everything.
#
# If a copy does not become healthy, both are put back on the release that was
# live before, and the script fails. Nothing else on the server is touched.
#
# Static files: the release's dist/client is copied into ./static, which Caddy
# serves, before any copy switches, and files of older releases stay for two
# days, so a tab opened before the release can still load its scripts.
set -euo pipefail
cd "$(dirname "$0")/.."

id=${1:?usage: ops/switch.sh <release-id>}
rel="releases/$id"
[ -f "$rel/serve.mjs" ] && [ -d "$rel/dist/client" ] || { echo "switch: no release $rel" >&2; exit 1; }

mkdir -p /var/lib/boks-ops slots flags static
exec 9>/var/lib/boks-ops/deploy.lock
flock -n 9 || { echo "switch: another release is in progress" >&2; exit 1; }

# alerts.sh stays quiet about a copy being recreated while this flag exists.
date +%s > flags/deploying
trap 'rm -f flags/deploying' EXIT

live=$(cat releases/CURRENT 2>/dev/null || true)
log() { echo "$(date '+%F %T') switch: $*"; }

wait_healthy() {  # <service>: up to 90 s
  local c status
  for _ in $(seq 1 90); do
    c=$(docker compose ps -q "$1")
    status=$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null || echo missing)
    [ "$status" = healthy ] && return 0
    [ "$status" = unhealthy ] && return 1
    sleep 1
  done
  return 1
}

put() {  # <colour> <release-id>
  ln -sfn "../releases/$2" "slots/$1"
  docker compose up -d --no-deps --force-recreate "app-$1" >/dev/null 2>&1
  wait_healthy "app-$1"
}

log "release $id (live: ${live:-none})"
rsync -a "$rel/dist/client/" static/

done_colours=()
for colour in blue green; do
  if put "$colour" "$id"; then
    done_colours+=("$colour")
    log "app-$colour is on $id"
    sleep 3   # Caddy sees the copy healthy within a second; leave margin
  else
    log "app-$colour did not become healthy on $id. Its last lines:"
    docker compose logs --tail 30 "app-$colour" >&2 || true
    if [ -n "$live" ] && [ "$live" != "$id" ]; then
      log "putting both copies back on $live"
      rsync -a "releases/$live/dist/client/" static/
      for back in "${done_colours[@]}" "$colour"; do put "$back" "$live" || log "app-$back did not come back healthy either"; done
    fi
    exit 1
  fi
done

if [ "$live" != "$id" ]; then
  [ -n "$live" ] && echo "$live" > releases/PREVIOUS
  echo "$id" > releases/CURRENT
fi
log "live: $id"

# Prune. Releases: the five newest, plus whatever CURRENT and PREVIOUS name.
prev=$(cat releases/PREVIOUS 2>/dev/null || true)
ls -1d releases/*/ 2>/dev/null | sed 's|releases/||; s|/$||' | sort -r | tail -n +6 | while read -r old; do
  [ "$old" = "$id" ] || [ "$old" = "$prev" ] || { rm -rf "releases/$old"; log "removed release $old"; }
done
# Static files: drop a file once it is in neither the live nor the previous
# release and has not been uploaded for two days.
find static -type f -mmin +2880 | while read -r f; do
  p=${f#static/}
  [ -e "$rel/dist/client/$p" ] || { [ -n "$prev" ] && [ -e "releases/$prev/dist/client/$p" ]; } || rm -f "$f"
done
find static -mindepth 1 -type d -empty -delete
