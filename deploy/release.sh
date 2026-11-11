#!/usr/bin/env bash
# Release boks to the server with no downtime. Run from the repository root
# on a machine with the `boks-app` SSH alias. The values the build needs are
# read from the server's /opt/boks/.env over SSH; nothing secret is kept locally.
#
#   npm run deploy                      check, build, upload and switch the committed HEAD
#   bash deploy/release.sh --list       releases on the server, which one is live
#   bash deploy/release.sh --rollback   back to the release that was live before
#   bash deploy/release.sh --rollback <id>
#
# deploy/ops/ and deploy/curtain/curtain.mjs (the server's scripts) are copied
# with every release. Other server
# configuration (compose.yml, Caddyfile, mailer/) is not part of a release: it
# changes rarely and is copied by hand (docs/hosting.md -> Deploy).
# Migrations are not part of it either: deploy/migrate.sh, before the release.
#
# Refuses a commit that does not contain everything on GitHub's main branch:
# a release replaces what is live, and older code would take shipped work off
# the site.
#
# Environment: ALLOW_DIRTY=1 releases uncommitted changes (the release id says
# "-dirty"); ALLOW_BEHIND=1 releases a commit behind main; SKIP_CHECKS=1 skips
# lint, typecheck and tests; BOKS_HOST overrides the SSH alias.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=${BOKS_HOST:-boks-app}
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

remote true || { echo "Cannot reach $HOST over SSH. docs/onboarding.md has how to get access." >&2; exit 1; }
sha=$(git rev-parse --short HEAD)
if [ -n "$(git status --porcelain)" ]; then
  [ "${ALLOW_DIRTY:-}" = 1 ] || { git status --short; echo "Uncommitted changes. Commit first, or ALLOW_DIRTY=1." >&2; exit 1; }
  sha="$sha-dirty"
fi
id="$(date +%Y%m%d-%H%M%S)-$sha"

# A release replaces what is live. Code that lacks a commit already on the
# shared main branch would silently take someone's shipped work off the site.
gh_remote=$(git remote -v | awk '/IvanCherep\/boks(\.git)? \(fetch\)/{print $1; exit}')
if [ -n "$gh_remote" ]; then
  git fetch -q "$gh_remote" main
  if ! git merge-base --is-ancestor "$gh_remote/main" HEAD; then
    [ "${ALLOW_BEHIND:-}" = 1 ] || {
      echo "This commit is missing work that is on $gh_remote/main:" >&2
      git log --oneline "HEAD..$gh_remote/main" | head -10 >&2
      echo "Merge or rebase onto $gh_remote/main first (ALLOW_BEHIND=1 overrides, for a deliberate rollback of code)." >&2
      exit 1
    }
  fi
else
  echo "warning: no remote for IvanCherep/boks; cannot check that this commit contains main" >&2
fi

if [ "${SKIP_CHECKS:-}" != 1 ]; then
  say "Checks: lint, typecheck, tests"
  npm run check
fi

say "Build $id"
ANON_KEY=$(remote 'sed -n "s/^ANON_KEY=//p" .env')
[ -n "$ANON_KEY" ] || { echo "No ANON_KEY in $REMOTE/.env on $HOST" >&2; exit 1; }
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

# The server's scripts (switch.sh among them) travel with the release, so the
# switch below is always the one this commit expects. Each file is replaced
# whole (written aside, then renamed), so a script running from cron finishes
# on the version it started with.
say "Server scripts"
rsync -rlpz --checksum --itemize-changes deploy/ops/ "$HOST:$REMOTE/ops/" -e "ssh -o LogLevel=ERROR" \
  | sed -n 's/^[<>]f[^ ]* /  updated ops\//p'
# The curtain job's script is mounted into its container, read on each run.
rsync -lpz --checksum --itemize-changes deploy/curtain/curtain.mjs "$HOST:$REMOTE/curtain/curtain.mjs" -e "ssh -o LogLevel=ERROR" \
  | sed -n 's/^[<>]f[^ ]* /  updated curtain\//p'
# The ribbon job (code, fonts, logo, its compose file); its container mounts it.
rsync -rlpz --checksum --itemize-changes --exclude node_modules deploy/ribbon/ "$HOST:$REMOTE/ribbon/" -e "ssh -o LogLevel=ERROR" \
  | sed -n 's/^[<>]f[^ ]* /  updated ribbon\//p'

say "Switch"
remote "ops/switch.sh $id"

say "Check $ORIGIN"
# From outside, through Caddy. Three tries per page, so a blip on this
# machine's network does not undo a good release; a page that keeps failing
# puts the previous release back.
for path in / /series /api/geo; do
  for try in 1 2 3; do
    code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$ORIGIN$path" || true)
    [ "$code" = 200 ] && break
    sleep 3
  done
  echo "$path $code"
  if [ "$code" != 200 ]; then
    if [ -n "$live" ] && [ "$live" != "$id" ]; then
      echo "$path answers $code. Putting $live back." >&2
      remote "ops/switch.sh $live" || echo "Rollback failed too. Look at the server." >&2
    else
      echo "$path answers $code, and there is no earlier release to go back to." >&2
    fi
    exit 1
  fi
done
say "Live: $id"
