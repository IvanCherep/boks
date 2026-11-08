#!/usr/bin/env bash
# Release boks to the server with no downtime. Run from the repository root
# on a machine with the `boks-app` SSH alias and ~/boks-secrets/stack.env.
#
#   npm run deploy                      check, build, upload and switch the committed HEAD
#   bash deploy/release.sh --list       releases on the server, which one is live
#   bash deploy/release.sh --rollback   back to the release that was live before
#   bash deploy/release.sh --rollback <id>
#
# Server configuration (compose.yml, Caddyfile, ops/, mailer/) is not part of
# a release: it changes rarely and is copied by hand (docs/hosting.md -> Deploy).
# Migrations are not part of it either: deploy/migrate.sh, before the release.
#
# Environment: ALLOW_DIRTY=1 releases uncommitted changes (the release id says
# "-dirty"); SKIP_CHECKS=1 skips lint, typecheck and tests; BOKS_HOST and
# BOKS_SECRETS override the SSH alias and the secrets file.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=${BOKS_HOST:-boks-app}
SECRETS=${BOKS_SECRETS:-$HOME/boks-secrets/stack.env}
ORIGIN=https://tryboks.com
REMOTE=/opt/boks
remote() { ssh -o LogLevel=ERROR "$HOST" "cd $REMOTE && $*"; }
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

case "${1:-}" in
  --list)
    remote 'echo "live: $(cat releases/CURRENT 2>/dev/null)  previous: $(cat releases/PREVIOUS 2>/dev/null)"; ls -1 releases | grep -v -e CURRENT -e PREVIOUS'
    exit 0 ;;
  --rollback)
    target=${2:-$(remote 'cat releases/PREVIOUS')}
    [ -n "$target" ] || { echo "No previous release recorded; pass an id from --list." >&2; exit 1; }
    say "Rolling back to $target"
    remote "ops/switch.sh $target"
    exit 0 ;;
  "") ;;
  *) echo "usage: deploy/release.sh [--list | --rollback [id]]" >&2; exit 2 ;;
esac

[ -f "$SECRETS" ] || { echo "No secrets file at $SECRETS" >&2; exit 1; }
sha=$(git rev-parse --short HEAD)
if [ -n "$(git status --porcelain)" ]; then
  [ "${ALLOW_DIRTY:-}" = 1 ] || { git status --short; echo "Uncommitted changes. Commit first, or ALLOW_DIRTY=1." >&2; exit 1; }
  sha="$sha-dirty"
fi
id="$(date +%Y%m%d-%H%M%S)-$sha"

if [ "${SKIP_CHECKS:-}" != 1 ]; then
  say "Checks: lint, typecheck, tests"
  npm run check
fi

say "Build $id"
ANON_KEY=$(set -a; . "$SECRETS"; echo "$ANON_KEY")
# vinext builds a Cloudflare Worker whenever wrangler.jsonc exists; hide it.
mv wrangler.jsonc wrangler.jsonc.release-off
trap 'mv wrangler.jsonc.release-off wrangler.jsonc 2>/dev/null || true' EXIT
rm -rf dist
BOKS_PLATFORM=node VITE_CONFIG_NATIVE_IGNORE_WARNING=true \
  VITE_SUPABASE_URL=$ORIGIN VITE_SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" npx vinext build
mv wrangler.jsonc.release-off wrangler.jsonc
out=dist/standalone
BOKS_BACKEND=$ORIGIN node scripts/check-deploy-target.mjs $out/dist/client $out/dist/server
node deploy/precompress.mjs $out/dist/client
cp deploy/app/serve.mjs $out/serve.mjs
printf '{"id":"%s","commit":"%s","built":"%s"}\n' "$id" "$(git rev-parse HEAD)" "$(date -u +%FT%TZ)" > $out/release.json

say "Upload"
live=$(remote 'cat releases/CURRENT 2>/dev/null' || true)
# Files with the same content as in the live release become hard links. A
# fresh build gives every file a new time, so compare content (--checksum) and
# do not keep times (no -t): --link-dest links only files equal in every kept
# attribute.
link=(); [ -n "$live" ] && link=(--checksum --link-dest="$REMOTE/releases/$live")
rsync -rlpz ${link[@]+"${link[@]}"} "$out/" "$HOST:$REMOTE/releases/$id/" -e "ssh -o LogLevel=ERROR"

say "Switch"
remote "ops/switch.sh $id"

say "Check $ORIGIN"
for path in / /series /api/geo; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN$path")
  echo "$path $code"
  [ "$code" = 200 ] || { echo "Not 200. Look, then: bash deploy/release.sh --rollback" >&2; exit 1; }
done
say "Live: $id"
