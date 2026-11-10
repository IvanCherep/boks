# Changing production without readers noticing

The playbook for an agent asked to change `https://tryboks.com`: release code,
add boks, add a series piece, fix data, change the server. Each kind of change
has one route below. Follow it as written; when a task fits none of them,
stop and ask the user rather than improvising on the live server.

How the machinery itself works (two app copies, Caddy, the switch, rollback)
is in `docs/hosting.md`. This page is what to do, in order.

## The promise, and what keeps it

A reader in the middle of a poem must not see an error, a blank page or a
reload because we shipped something. What makes that true:

- **Two app copies** (`app-blue`, `app-green`) behind Caddy. A release replaces
  one at a time; the other answers everything meanwhile.
- **Warm-up and self-check.** A new copy requests its own main pages, a bok
  page and its preview image before it takes traffic. A 5xx there stops the
  release before the second copy is touched, and both go back to the live
  release (`deploy/app/serve.mjs`, `deploy/ops/switch.sh`).
- **Automatic rollback.** After the switch `npm run deploy` checks the site
  from outside; a page that keeps failing puts the previous release back.
- **Old tabs keep working.** A tab opened before the release runs the old
  client for hours or days: its scripts are kept for two days, and the
  database and API must still answer it. This is the rule most changes trip
  over (below, "Compatibility").
- **Data needs no release at all.** Boks live in the database; a new bok is in
  the feed as soon as it is published. Its embedding (feed ranking) and its
  link-preview card and loop arrive by themselves within 15 minutes (the
  `embedder` and `curtain` jobs).

## Before anything

```bash
git fetch github && git rebase github/main      # never work on a stale main
bash deploy/release.sh --list                   # what is live, what is previous
```

If `package.json` says `"deploy": "... wrangler deploy ..."`, the checkout is
out of date: stop and update (AGENTS.md, the box at the top).

**Every production command targets the server through the SSH alias
`boks-app`.** Any command with `--linked` (`supabase db push --linked`,
`supabase db query --linked`, `supabase storage cp ... --linked`) goes to the
old Supabase Cloud project, which is only a backup since 2026-11-07: it
reports success and changes nothing on tryboks.com. Older docs may still show
such commands; the routes on this page replace them.

## Which route

| The change | Route | Release? | Readers notice? |
|---|---|---|---|
| Code, styles, texts of the interface, images in `public/` | [Code](#code) | yes | no |
| New boks from a curated batch (public domain) | [Boks](#new-boks) | no | no |
| A few boks by hand, or an author's batch of files | `/admin` -> Catalogue | no | no |
| Fix a title or text, hide or restore a bok | [Data fix](#a-data-fix) | no | no |
| A new series piece (cinema or immersive poem) | [Series piece](#a-series-piece) | yes | no |
| A living author's piece | [Author-held piece](#a-living-authors-piece) | yes | no |
| A new table, column, RPC, policy | [Schema](#schema) | migration, then release | no |
| `deploy/ops/*`, `deploy/curtain/curtain.mjs` | travel with every release | yes | no |
| `deploy/Caddyfile` | [Server config](#server-configuration) | no | no |
| `deploy/compose.yml` (app copies only) | [Server config](#server-configuration) | the next release applies it | no |
| Restarting `db`, `rest`, `auth`, `caddy`, `mailer`; a new service; server size | **ask the user first** | - | yes, seconds |
| Change the algorithm split | `/admin` -> Recommendation lab | no | no |

### Code

```bash
npm run check                         # lint, types, tests: the release runs it too
npm run deploy                        # build, upload, switch, check
git push github HEAD:main             # right after: the next release is built from main
```

Read the release output, it says what happened:

- `switch: app-blue warm-up: {"ok":true, ...}`: each page with its status and
  time. A page slower than a second here is worth a look before it bites.
- `/ 200`, `/series 200`, `/api/geo 200` and `Live: <id>`: done.
- `failed on <id>` or `Putting <live> back`: nothing reached readers, or it
  was taken back. Read the lines before it, fix, release again.

`npm run deploy` refuses a commit that lacks anything on `github/main`; rebase,
never `ALLOW_BEHIND=1` unless the user asked for a deliberate rollback of code.

### New boks

The database does the work; nothing is released. For a curated batch
(`docs/catalogue-import.md` §4b has the file format, the licence rule and the
three duplicate guards):

```bash
node scripts/build-catalogue-sql.mjs /tmp/add.sql work/<batch>/ru.jsonl work/<batch>/en.jsonl
bash deploy/sql.sh /tmp/add.sql            # dry run: prints the counts, rolls back
bash deploy/sql.sh /tmp/add.sql --apply    # writes it
```

Then the publication-date re-spread from `docs/catalogue-import.md` §4b, the
same way (a file, dry run, `--apply`). Nothing else: within 15 minutes each new
bok has its embedding and its curtain card. Check one:
`https://tryboks.com/b/<id>` and its preview in a messenger (Telegram through
`go.tryboks.com/b/<id>`, see `docs/hosting.md`).

`deploy/sql.sh` runs the file in **one transaction** on the server, with a
60-second statement limit and a 5-second lock limit: a mistake fails whole
instead of half-applying or holding a table readers need. Always run the dry
run first and read what it printed.

### A data fix

Prefer `/admin` (Content: edit, delete, restore) when the user can do it there.
From SQL, the admin functions check `auth.uid()`; act as the `@boks` admin
inside the file:

```sql
select set_config('request.jwt.claims', '{"sub":"c990a7fc-1114-4a01-984b-e6ced9eeaa74","role":"authenticated"}', true);
select public.archive_bok('<bok id>', 'Why, and when it may come back.');
-- select public.restore_archived_bok('<bok id>');
```

```bash
bash deploy/sql.sh /tmp/fix.sql && bash deploy/sql.sh /tmp/fix.sql --apply
```

A plain `update public.reels set title = ... where id = ...` is fine for a
typo. Never `delete` a bok: archive it; deletion is the admin console's
two-step `delete_archived_bok`.

### A series piece

The bok must exist first (published, in `published_boks`). Then the piece is
assets plus registry lines, released as code:

1. Produce it: `docs/reading-formats.md` §3 (cinema) or §4 "Adding a poem",
   audio by `docs/media-generation.md`. Loudness rules matter: the voice at
   -22 LUFS, the theme 13 dB under it.
2. Register it (`components/boks/poetry/poems.ts`, or `components/boks/cinema/series.ts` for cinema) and
   add the shelf entry and cover (`components/boks/series/series-catalogue.ts`,
   `public/series/<name>.webp`), §5 of the same doc.
3. Optionally a hand-made link-preview cover: `public/share/art/<name>.jpg`
   and a crop in `lib/boks/curtain.tsx` (`curtainPosition`).
4. `npm run check` (the series tests catch a missing cover, a wrong duration,
   an entry that would open as plain text), look at it at phone size, then
   [Code](#code).

Files under `public/` are served from disk by Caddy and cached for an hour.
**Do not replace a file that a live page already uses with different content
under the same name**; give the new version a new name. Old tabs and caches
keep asking for the old one.

### A living author's piece

The repository is public. A living author's text, recording and photos never
go into git, even with permission to publish on boks. They live in the
server's link-only folder; `docs/link-only-pieces.md` has the whole procedure.
The production parts:

```bash
rsync -a <scratch folder>/ boks-app:/opt/boks/link-only/<token>/   # the files
bash deploy/sql.sh <scratch>/bok.sql                                # the bok and its rights row, dry run
bash deploy/sql.sh <scratch>/bok.sql --apply
```

Then the registry line pointing at `/l/<token>/f/manifest.json` and the shelf
entry, released as [Code](#code). The SQL file stays in the scratch folder:
it holds the author's text.

### Schema

A migration must be survivable by the code already live **and** by old tabs,
because it is applied before the release and both keep running after it.

1. Write a new file in `supabase/migrations/` (never edit an applied one),
   additive only: new tables, new nullable columns or columns with defaults,
   new RPCs, new versions of RPCs under the same signature that still return
   what the old client reads. Grants in the same file (`docs/adr/0011`).
2. `npm run verify:schema` (a throwaway Postgres).
3. `bash deploy/migrate.sh` (dry run: lists what production lacks), then
   `bash deploy/migrate.sh --apply`.
4. Release the code that uses it ([Code](#code)).
5. Removing or renaming something old is a **later** migration, after a
   release has stopped using it and old tabs have had two days.

A migration that rewrites a big table or takes a long lock is a short outage
for readers: ask the user, and plan it for the quiet hours (night, Moscow
time).

### Server configuration

These are not in a release; change them deliberately.

- **Caddyfile.** Validate by reading the diff, then copy without replacing the
  file (the container's bind mount would keep the old one) and reload, which
  drops no connection:

  ```bash
  ssh boks-app 'cd /opt/boks && diff Caddyfile -' < deploy/Caddyfile
  rsync --inplace deploy/Caddyfile boks-app:/opt/boks/Caddyfile
  ssh boks-app 'cd /opt/boks && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile'
  ```

- **compose.yml.** Diff first: the server's copy may hold a change that is not
  in git, and copying over it loses it. A change to the app copies takes
  effect at the next release (the switch recreates them); never `docker
  compose up` them by hand. A change to any other service needs `docker
  compose up -d <service>`, a few seconds of outage: ask the user.
- **deploy/ops/, deploy/curtain/curtain.mjs.** Copied by every release. A
  change to `deploy/curtain/Dockerfile` needs `docker compose --profile jobs
  build curtain` on the server.

## Compatibility: the rules that keep old tabs alive

- An RPC or view the browser calls keeps its name, its arguments and the
  fields it returns until a later release; add, never change in place.
- A route (`/b/<id>`, `/series`, `/@handle`, `/api/...`) never disappears in
  one step; redirect the old one.
- Static files under `public/` keep their content under their name (see the
  series section); built scripts under `/_next/static/` are hashed and safe.
- Every visible string goes through `defineMessages` in all interface
  languages (AGENTS.md); a release that forgets one shows the key to readers.

## After a change

```bash
bash deploy/release.sh --list                     # what is live
ssh boks-app 'journalctl -t boks-app --since "-1h" -o cat | grep -iE "error|fail|unhandled" | sort | uniq -c | sort -rn | head'
```

The app logs only its start, stop and errors, so an empty answer means no
errors. Alerts (a service down, the overload page, disk, mail) go to Telegram
by themselves (`deploy/ops/alerts.sh`, `overload.sh`).

## When it goes wrong

| What | Do |
|---|---|
| A release misbehaves after `Live:` | `bash deploy/release.sh --rollback` (no downtime; only to a release that works with the current schema) |
| A rollback refused by the self-check while the database itself is down | on the server: `cd /opt/boks && NO_SELF_CHECK=1 ops/switch.sh <id>` |
| A data change was wrong | write the reverse SQL and run it the same way; there is no undo button |
| The overload page is on (`flags/busy.on`) | it switches itself off after 3 calm minutes; do not release into it |
| Anything you do not understand on the server | stop, show the user what you saw |

## Never

- `wrangler deploy`, or anything with `--linked`, for production.
- `supabase config push`: it clears the mail password and stops every sign-in email.
- `docker compose restart` / `up` of the app copies by hand; `restart caddy`
  for a Caddyfile change.
- Editing an applied migration; `delete` on `reels`.
- A living author's text, recording or photo in git.
- Releasing without pushing to `github/main` right after.

## Working as an agent in Claude Code

The auto-mode permission classifier may refuse production commands (SSH
reads and writes, `npm run deploy`) even after the user approved the task. Do
not try to get around it. Give the user each command on its own line as `!
<command>`, one per message line, never chained with `&&` across separate
steps (a combined input has run only its first part), and continue from the
output they paste back.
