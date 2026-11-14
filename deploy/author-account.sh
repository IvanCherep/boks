#!/usr/bin/env bash
# An author account the team holds until the author takes it over.
#
# Run from a machine with the `boks-app` SSH alias, like deploy/migrate.sh:
#
#   bash deploy/author-account.sh create <handle> <placeholder-email>
#   bash deploy/author-account.sh move   <handle> <bok-id> [<bok-id>...]
#   bash deploy/author-account.sh email  <handle> <real-email>
#   bash deploy/author-account.sh show   <handle>
#
# `create` makes a GoTrue user (confirmed, so no mail is sent) and its profile
# with exactly that handle. Use a placeholder address nobody outside the team
# can read, e.g. <handle>@authors.tryboks.com: whoever reads it can sign in.
# `move` makes the account the author of published boks (byline unchanged).
# `email` gives the account the author's real address; from then on the
# author signs in with a code sent there, straight into this account.
#
# Nothing here goes through the public API: GoTrue is called inside the
# server's private network, the database as its owner.
set -euo pipefail

HOST=${BOKS_HOST:-boks-app}
REMOTE=${BOKS_REMOTE:-/opt/boks}
command=${1:-}
handle=${2:-}

usage() { sed -n '4,10p' "$0" >&2; exit 2; }
[ -n "$command" ] && [ -n "$handle" ] || usage
[[ "$handle" =~ ^[a-z][a-z0-9_]{2,23}$ ]] || { echo "Not a handle: $handle" >&2; exit 2; }
uuid='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
email_shape='^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'

# psql on the server, as the database owner; variables are passed with -v.
psql_remote() { ssh -o LogLevel=ERROR "$HOST" "cd $REMOTE && docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 -At $*"; }

# GoTrue's admin API from inside the mailer container, which shares GoTrue's network.
gotrue() {
  local method=$1 path=$2 body=$3
  ssh -o LogLevel=ERROR "$HOST" "cd $REMOTE && key=\$(sed -n 's/^SERVICE_ROLE_KEY=//p' .env) && docker compose exec -T -e KEY=\"\$key\" -e METHOD=$method -e URLPATH=$path -e BODY='$body' mailer node -e '
    fetch(\"http://localhost:9999\" + process.env.URLPATH, {
      method: process.env.METHOD,
      headers: { Authorization: \"Bearer \" + process.env.KEY, apikey: process.env.KEY, \"Content-Type\": \"application/json\" },
      body: process.env.BODY || undefined,
    }).then(async (r) => { const t = await r.text(); if (!r.ok) { console.error(r.status, t); process.exit(1); } console.log(t); });
  '"
}

user_id_of() {
  psql_remote "-v handle=$handle" <<'SQL'
select user_id from public.user_profiles where lower(handle) = lower(:'handle');
SQL
}

case "$command" in
  create)
    email=${3:-}
    [[ "$email" =~ $email_shape ]] || usage
    [ -z "$(user_id_of)" ] || { echo "@$handle already exists." >&2; exit 1; }
    created=$(gotrue POST /admin/users "{\"email\":\"$email\",\"email_confirm\":true}")
    id=$(printf '%s' "$created" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
    [[ "$id" =~ $uuid ]] || { echo "GoTrue did not return a user id." >&2; exit 1; }
    psql_remote "-v id=$id -v handle=$handle" <<'SQL'
insert into public.user_profiles (user_id, handle) values (:'id', :'handle')
on conflict (user_id) do update set handle = excluded.handle;
SQL
    echo "@$handle created: $id ($email)"
    ;;
  move)
    shift 2
    [ $# -gt 0 ] || usage
    for bok in "$@"; do [[ "$bok" =~ $uuid ]] || { echo "Not a bok id: $bok" >&2; exit 2; }; done
    id=$(user_id_of)
    [ -n "$id" ] || { echo "No @$handle." >&2; exit 1; }
    ids=$(printf "'%s'," "$@"); ids=${ids%,}
    psql_remote "-v id=$id" <<SQL
with moved as (
  update public.reels set author_user_id = :'id'
  where id in ($ids) and status = 'published'
  returning title, slug
)
select title || '  ->  ' || coalesce(slug, '') from moved;
SQL
    echo "Moved to @$handle (asked for $# boks; the lines above are the ones moved)."
    ;;
  email)
    email=${3:-}
    [[ "$email" =~ $email_shape ]] || usage
    id=$(user_id_of)
    [ -n "$id" ] || { echo "No @$handle." >&2; exit 1; }
    gotrue PUT "/admin/users/$id" "{\"email\":\"$email\",\"email_confirm\":true}" >/dev/null
    echo "@$handle now signs in with $email."
    ;;
  show)
    psql_remote "-v handle=$handle" <<'SQL'
select p.handle, u.email, p.user_id,
       (select count(*) from public.reels r where r.author_user_id = p.user_id and r.status = 'published') as published
from public.user_profiles p join auth.users u on u.id = p.user_id
where lower(p.handle) = lower(:'handle');
SQL
    ;;
  *) usage ;;
esac
