# boks Hosting Guide

> **⚠️ The one rule:** release with `npm run deploy` from code that contains everything on `github/main`,
> migrations first with `bash deploy/migrate.sh`. Never `wrangler deploy` the app, never
> `supabase db push --linked` (old Supabase Cloud project), never restart the app containers by hand.
> If your `package.json` `deploy` script still says `wrangler`, your checkout is out of date: update it first.

## Current Hosting Shape

Since 2026-11-07 boks runs on its own server in Russia (Selectel, Moscow),
not on Cloudflare Workers and Supabase Cloud.

- Address: `https://tryboks.com`. `tryboks.ru` and `www.tryboks.com` redirect
  to it with path and query; on `tryboks.ru` the API, sign-in and `/_next/`
  are still answered, for tabs opened there before 2026-11-08.
- Server: `boks-app` (SSH alias; IP `135.106.236.123`), Ubuntu, 2 vCPU / 4 GB,
  everything in `/opt/boks`, one Docker Compose stack: `deploy/compose.yml`.
- Services: `db` (Postgres 17, Supabase image), `auth` (GoTrue), `rest`
  (PostgREST), `app-blue` and `app-green` (two copies of the Node build of the
  app), `caddy` (TLS, static files, routing: `deploy/Caddyfile`), `mailer`
  (GoTrue's send-email hook, Resend). `embedder` is a 15-minute job, not a
  service.
- DNS: `tryboks.com` on Cloudflare, **DNS only** (grey cloud). Never turn on
  the proxy: Cloudflare is throttled in Russia. `tryboks.ru` in Selectel DNS.
- Curtain loops for link previews: `deploy/ops/curtain.sh` every 15 minutes from `/etc/cron.d/boks-ops` runs the `curtain` job (`deploy/curtain`, image built on the server: `docker compose --profile jobs build curtain`), writing `link-only/curtain/<id>-<key>.mp4`, and the poster `<id>-<key>.jpg` (asked of the app at a calm moment, up to 30 a run), which `/b/<id>/image` serves before drawing one. `curtain.mjs` is copied by every release.
- Ops (cron in `/etc/cron.d/boks-ops`, scripts in `deploy/ops/`): alerts (including every new account, and the Resend daily quota: 60, 80 and 95 of 100 emails),
  daily and weekly reports and trend forecasts to the team Telegram group
  through the `boks-telegram` Worker (Telegram is blocked from the server), and
  an overload guard that shows new visitors a waiting page (`deploy/busy/`).
- Visitor country: without Cloudflare in front, `/api/geo` looks the
  connecting address up in DB-IP's free country database
  (`lib/boks/geoip.ts`, file `/opt/boks/geoip/country.mmdb`, refreshed on the
  3rd of each month by `deploy/ops/geoip.sh`; CC BY 4.0, credited in
  `/privacy`). Only the country code is kept, never the address.
- Secrets: `/opt/boks/.env` on the server (template `deploy/.env.example`), a
  copy in `~/boks-secrets/stack.env` on the founder's machine. The deploy
  scripts read what they need from the server over SSH. Never in the
  repository.

What is where on the server:

```text
/opt/boks/
  compose.yml  Caddyfile  .env           copies of deploy/compose.yml, deploy/Caddyfile
  releases/<id>/                         one app build per release (deploy/release.sh)
  releases/CURRENT, releases/PREVIOUS    the live release id and the one before it
  slots/blue, slots/green                symlinks to the release each app copy runs
  static/                                static files Caddy serves: live release + recent ones
  ops/  mailer/  embedder/  busy/  templates/  link-only/  flags/
  geoip/country.mmdb                     visitor country database (ops/geoip.sh, monthly)
```

## Environment Variables

The build needs two public values, both set by `deploy/release.sh`:

- `VITE_SUPABASE_URL` = `https://tryboks.com` (GoTrue and PostgREST are behind
  the same origin, at `/auth/v1` and `/rest/v1`);
- `VITE_SUPABASE_PUBLISHABLE_KEY` = the anon key (`ANON_KEY` in the secrets).

Local development is unchanged: `.env.local` from `.env.example`
(`docs/local-environment-runbook.md`). Never put a service-role key in browser
code, source, screenshots or docs.

Auth (GoTrue, configured in `deploy/compose.yml`): anonymous sign-ins for
guests, email OTP (link or 6-digit code) for accounts, `SITE_URL` and the
redirect allow-list = `https://tryboks.com`.

## Email Delivery

GoTrue does not send mail itself: its send-email hook calls `deploy/mailer`,
which renders `supabase/templates` and sends through the Resend API from
`hello@tryboks.com`, retrying from `hello@tryboks.ru` if Resend refuses. Both
domains are verified in Resend (DKIM, return path, DMARC). Replies go to
`support@tryboks.com` (Cloudflare Email Routing). A failed send or a fallback
is reported to Telegram by `deploy/ops/alerts.sh`.

## Deploy

A release replaces the app with **no downtime**. Run it from the repository
root on a machine with the `boks-app` SSH alias; that is the only access it
needs. The build's values (anon key) and the migration password are read from
`/opt/boks/.env` over SSH, so no secrets file is kept or handed over:

```bash
git status --short              # clean: a release is a commit
bash deploy/migrate.sh          # when supabase/migrations changed: dry run
bash deploy/migrate.sh --apply  # then apply, BEFORE the code that needs them
npm run deploy                  # = bash deploy/release.sh
git push origin main            # right away: the next release is built from main
```

`npm run deploy` does, in order, and stops at the first failure:

1. refuses uncommitted changes (`ALLOW_DIRTY=1` overrides; the id says `-dirty`);
   and a commit that lacks anything on `github/main` (`ALLOW_BEHIND=1` overrides):
   a release replaces what is live, so older code takes shipped work off the site;
2. `npm run check`: lint, typecheck, tests (`SKIP_CHECKS=1` skips);
3. builds the Node server (`BOKS_PLATFORM=node`, `wrangler.jsonc` moved aside
   for the build), refuses a bundle that names a local backend
   (`check:deploy-target`), precompresses static files, adds
   `deploy/app/serve.mjs` and `release.json`;
4. uploads it to `/opt/boks/releases/<id>` (`<id>` = time + commit; files
   unchanged since the live release become hard links, so it is quick);
5. copies `deploy/ops/` and `deploy/curtain/curtain.mjs` to the server (only
   changed files), so the switch is the one this commit expects;
6. runs `ops/switch.sh <id>` on the server;
7. checks from outside that `/`, `/series` and `/api/geo` answer 200 (three
   tries each); if one keeps failing, it puts the previous release back by
   itself and fails.

How `ops/switch.sh` keeps the site up:

- the app runs as two copies, `app-blue` and `app-green`; Caddy sends each
  request to the less busy one and polls `/__health` on both every second;
- it copies the release's static files into `static/`, then switches one copy:
  the old process answers 503 on `/__health`, Caddy stops sending it requests,
  it finishes the ones in flight and exits; the new one starts on the new
  release and gets traffic once its health check passes. Then the other copy.
  A request that cannot reach one copy is retried on the other;
- a new copy warms up before its first 200 (`deploy/app/serve.mjs`): it asks
  itself for `/`, `/series`, `/api/geo`, one bok page and that bok's preview
  image, so the first readers do not get cold code. That is also the
  release's self-check: if any of them answered 5xx or timed out, the switch
  stops before touching the second copy (its log line `warm-up:` lists each
  page with its status and time);
- if a copy does not become healthy or fails the self-check, both are put
  back on the previous release and the command fails (`NO_SELF_CHECK=1
  ops/switch.sh <id>` skips the self-check, for an urgent rollback while the
  database itself is down);
- a stopping copy answers 503 for 5 s (Caddy needs two failed checks to take it
  out), then finishes its requests and exits as soon as they are done;
- `alerts.sh` stays quiet about the copies while `flags/deploying` exists.

**Open tabs.** A reload always gets the new release. A tab that is not
reloaded keeps running the version it loaded, so its scripts must still be
there: `static/` keeps the files of the live and the previous release, and
anything uploaded in the last two days. A tab older than that which asks for a
missing file reloads itself once (`lib/boks/stale-release.ts`).

**Migrations go first**, and only ones the live code also survives: the
database is shared by both copies and by every open tab during and after a
release.

**Not part of a release:** `deploy/compose.yml`, `deploy/Caddyfile`,
`deploy/mailer/`, `deploy/busy/` (`deploy/ops/` is: step 5 above). They change
rarely; copy the changed file and apply it deliberately:

```bash
rsync -a deploy/ops/ boks-app:/opt/boks/ops/                          # scripts, between releases: nothing to restart
rsync -a deploy/busy/ boks-app:/opt/boks/busy/                        # waiting page: nothing to restart
rsync -a supabase/templates/ boks-app:/opt/boks/templates/            # email templates: read on every send
rsync --inplace deploy/Caddyfile boks-app:/opt/boks/Caddyfile        # --inplace: the bind mount keeps seeing the same file
ssh boks-app 'cd /opt/boks && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile'
                                                                     # a graceful reload: no connection is dropped
rsync -a deploy/compose.yml boks-app:/opt/boks/compose.yml && \
  ssh boks-app 'cd /opt/boks && docker compose up -d <service>'        # only the service you changed
```

Restarting `caddy`, `auth`, `rest` or `db` is a short outage (seconds for
Caddy); do it deliberately, not as part of a release. A Caddyfile change never
needs a restart: copy it with `--inplace` and reload, as above (without
`--inplace` rsync replaces the file and the container keeps the old one). Never `docker compose up
-d` the app copies by hand to release: use `npm run deploy`.

## Verify Production

`npm run deploy` already checks the three addresses. By hand:

```bash
bash deploy/release.sh --list                      # live and previous release
curl -s -o /dev/null -w '%{http_code}\n' https://tryboks.com/
curl -s https://tryboks.com/api/geo
ssh boks-app 'cd /opt/boks && docker compose ps'   # every service Up, app copies (healthy)
```

Then open `https://tryboks.com/`, `/series` and `/admin` in a browser and check
the console for errors. HTML responses carry CSP, HSTS, `nosniff`,
`X-Frame-Options: DENY`, Referrer-Policy and Permissions-Policy.

## Rollback

```bash
bash deploy/release.sh --rollback          # to releases/PREVIOUS
bash deploy/release.sh --rollback <id>     # to any release from --list (five are kept)
```

A rollback is the same no-downtime switch. It moves the app only: the database
keeps every migration, so roll back only to a release that works against the
current schema. When in doubt, repair forward from current source.

## Link Previews in Telegram

Telegram builds a link preview on its own servers abroad, and traffic between
them and our server in Russia is cut (checked 2026-11-08: no packet from
Telegram's address ranges reached the server while a link was being sent). So
a `tryboks.com` link previews as nothing in Telegram. VK, OK and Yandex build
previews from Russia, and WhatsApp on the sender's phone, so they are fine.

`go.tryboks.com` is the address to share where Telegram matters. It is the
`boks-link-preview` Cloudflare Worker (`deploy/link-preview`): a preview bot
gets a small page of its own built from the tryboks.com page's preview tags,
with every address in it (image, `og:url`, canonical) moved to `go.`; a
person gets a 302 to the same path on tryboks.com and never touches Cloudflare
again. One small request per click, nothing stored there; `tryboks.com` DNS is
untouched. Deploy it only with
`npx wrangler deploy --config ./wrangler.toml --no-autoconfig` from that
folder - without the flags wrangler deploys the vinext app instead.

Every link the app hands out is on `go.` (`lib/boks/share-link.ts`): a bok
is `go.tryboks.com/b/<slug>` - its title and the author's surname in Latin
letters, given once on publishing and never changed, with the start of the id
added for a twin (`20261109100000_boks_bok_slugs.sql`); an author is
`go.tryboks.com/@<handle>`, served by `/a/<handle>` (`proxy.ts`); tracked links
and `/series/<section>` likewise. Old `/b/<uuid>` links keep working.

What it took (2026-11-08): with the app's own page, or with `og:url` still
naming tryboks.com, Telegram fetched the page and showed nothing; a VK preview
worked from the start. Verified in Telegram with the small page. Cloudflare's
Bot Fight Mode on the zone injects a challenge script and can block preview
bots before the Worker runs - keep it off if previews stop.

## Author Accounts the Team Holds

An author who has not signed in yet (Алексей Прохоров, @prokhorov) gets a real
account the team holds: `bash deploy/author-account.sh create <handle>
<handle>@authors.tryboks.com`, then `move <handle> <bok-id>...` to make it
the author of their boks. The placeholder address has no mailbox, so nobody can
sign in to it. When the author's address is known, `email <handle> <address>`:
from then on a code sent there signs them in to this very account, with their
boks, handle and followers. `show <handle>` prints where an account stands.

## Load and Limits

Measured on 2026-11-07 (`deploy/loadtest/`): about 500 readers at once are
comfortable, about 25-30 new readers per second for a short burst, about 4-5
per second sustained; the first feed load is the bottleneck. Above that, the
overload guard (`deploy/ops/overload.sh`) shows new visitors the waiting page
and reports to Telegram; the next step is a larger server in Selectel.

## Before 2026-11-07: Cloudflare Workers and Supabase Cloud

Until the move the app was the Cloudflare Worker `read` with static assets and
the database was Supabase project `vcmrvnihbptostnzaean`. `wrangler.jsonc` and
the Worker code path (`vite.config.ts` without `BOKS_PLATFORM=node`) remain for
local development with `npm run start`; **do not `wrangler deploy` the app** -
`tryboks.com` no longer points at the Worker. The Supabase project is kept as a
backup after the move and is to be deleted once server backups exist. The rest
of this file is the record of that period.

### The Supabase Pro Plan, and What It Must Not Cost

Audited 2026-09-25 against the dashboard and the Management API. The rule for
this project is one subscription and nothing else on the invoice, so every line
below is either "included" or "do not turn on".

**On, included, already in use**

| Perk | State |
|---|---|
| Micro compute | Applied. 125 compute hours this cycle, $1.68 against the $10 of compute credits the plan includes - Micro for a whole month costs about $9.81, so it fits, but **only for one instance**. |
| Daily backups | Running. Nine kept, most recent 2026-09-25 02:17 UTC. |
| 8 GB disk | 2 GB provisioned, 0.32 GB used, auto-expands to 8 GB. |
| No project pausing | Automatic on paid plans. |
| 7-day log retention, 20 GB ingestion, 2 000 GB log query | 0.06 GB ingested, 1.43 GB queried. Barely touched; the Logs Explorer is the tool for an auth or PostgREST question nothing in the app records. |
| Advisors | Free on every plan. We had never opened them; see below. |
| Email support | Available to the account owner. |

**Headroom, at the traffic we expect.** 250 GB egress (used 0.02), 100 000 MAU
(used 4), 2 M Edge Function invocations (used 113), 100 GB Storage (unused),
500 Realtime connections and 5 M messages (both unused). A hundred readers do
not come close to any of these. Realtime and Storage are included and idle: if
live comment counts or bok images are ever wanted, they cost nothing extra.

**Off, and each one must stay off**

| Thing | Why it would cost money |
|---|---|
| Spend cap disabled | It is **enabled**, and the dashboard confirms "you are currently not billed for overages". Turning it off is what converts every limit above into a bill. |
| Branching | The welcome email lists it as a Pro feature. Each preview branch runs its own compute and is billed by the hour, and it eats the same $10 credit Micro already uses. There are no branches; keep it that way. |
| Point-in-time recovery, dedicated IPv4, custom domain | All three are paid add-ons, all three disabled. `api.tryboks.com` costs $10/mo through this door. |
| Read replicas, io2 disk, disk above 8 GB | Paid. Nothing to do but watch `served_feed`, which is the fastest-growing table at roughly 10 KB per feed load. |

**The dedicated pooler: deliberately not used.** The welcome email recommends
it, and it is included. It does not apply here: nothing opens a Postgres
connection to this project except the CLI during a migration. The browser and
the Worker both speak HTTP to PostgREST. The dedicated pooler would run
Supavisor on the same 1 GB Micro instance to shorten a hop we do not take. The
shared pooler (`aws-0-eu-west-2.pooler.supabase.com`) stays.

**Direct Postgres requires SSL.** Enabled during the 2026-09-25 security audit;
`npx supabase ssl-enforcement get --experimental --project-ref
vcmrvnihbptostnzaean` reports `database: true`. Network restrictions - a Pro
entitlement this project is allowed but has never set - still leave direct
Postgres reachable from `0.0.0.0/0`. The app never opens a direct connection;
restricting CIDRs would affect the migration path and is unsafe until the
address running `supabase db push` is stable or a deliberate lockout/recovery
procedure exists.

#### What the Advisors found the first time we read them

Free, and worth the five minutes. The Security Advisor reported 3 errors and
106 warnings; `supabase/migrations/20260925120000_boks_advisor_hardening.sql`
acts on them and argues the case for what is left alone. In short: thirteen
function signatures had no fixed `search_path` (now pinned), four trigger
functions were callable over HTTP as RPCs (now revoked - and the assertion
written for it found the fourth, which the truncated dashboard list had not
shown), and `boks_embedding_coverage` - which reports the count of boks waiting
in review - was granted to `anon` (now admin-only). The three "Security Definer
View" errors are deliberate and stay.

The 2026-09-25 follow-up audit added migration `20260925160420`: browser
first-admin claiming and bare-anon writes were revoked, high-volume ingestion
RPCs were bounded, terms are enforced below the UI, and all eleven missing
foreign-key indexes were added. Confirm email, leaked-password protection, and
database SSL are enabled. The remaining Advisor warnings are the intentional
public projections/read RPCs and anonymous Auth needed by the guest feed; see
`docs/security.md` for the decision record.

The Performance Advisor reported 0 errors and 0 warnings. One thing it does not
say, which `supabase inspect db index-stats --linked` does: **the HNSW index
`reels_embedding_cosine` has never been scanned.** At 547 rows Postgres reads
the table instead, and the ranker fetches embeddings rather than asking the
database for nearest neighbours, so nothing is broken - but the index earns
nothing today and should be re-checked before the catalogue grows.

Re-run any of this with:

```bash
npx supabase inspect db db-stats --linked        # size, cache hit, WAL
npx supabase inspect db index-stats --linked     # what the indexes are doing
npx supabase inspect db traffic-profile --linked # which tables take the writes
npx supabase backups list                        # daily backups, PITR state
npx supabase branches list                       # must stay empty
```

### Signing In With A Code

The reader can type a code instead of following the link, because the link
cannot land everywhere: opened from a mail app, or from the app installed to a
home screen, it arrives in a different browser context from the one that asked
for it, and the PKCE verifier stays behind in the context nobody is looking at.
That is issue #6 - in the web app there was no way in at all.

Both come from the same `signInWithOtp` call and arrive in the same email;
nothing extra is sent. **The code only appears if the Magic Link template asks
for it.** Supabase does not add `{{ .Token }}` on its own, and the templates are
not in `supabase/config.toml` - the commented-out blocks there are examples, and
`supabase config push` must never be run, because `pass = "env(RESEND_API_KEY)"`
means a push without that variable clears the SMTP password and stops every
auth email.

Two ways to do it, both about a minute.

**A script, so nothing is clicked twice.** `bash scripts/set-magic-link-template.sh`
asks for a Supabase personal access token (made at
https://supabase.com/dashboard/account/tokens, revokable straight afterwards),
types it hidden, and PATCHes exactly two fields of the auth config through the
Management API: the Magic Link template and the OTP length. It touches nothing
else, and it prints back whether the code is in the template and whether SMTP is
still set. The token never goes into a file, a commit, or a chat.

**Or by hand:** **Authentication -> Emails -> Magic Link** in the dashboard.

```html
<h2>Sign in to boks</h2>
<p>Your code:</p>
<p style="font-size:28px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
<p>Or open this link: <a href="{{ .ConfirmationURL }}">Sign in</a></p>
<p>The code lasts an hour.</p>
```

**And the same code in Confirm signup.** An address with no confirmed account
yet - a reader signing in for the first time, or one who never opened an
earlier email - is sent **Confirm signup**, not Magic Link. Without
`{{ .Token }}` there, that reader gets only the link, which is the case the
code exists for. The script sets both; by hand it is **Authentication ->
Emails -> Confirm signup**, the same block with its own wording.

Set the OTP length to 6 on the same screen if it is anything else; six digits is
the product contract and what `boksEmailCodeLength` expects. The local
`supabase/config.toml` also sets six digits and both email templates, so local
sign-in exercises the same code path. Editing the local file does not update
the already running Auth container or hosted Auth.

Until that paste, the code field on the "check your email" screen has nothing to
accept, and the screen tells the reader to use a code that is not in their
email - so the client change waits for it rather than shipping ahead of it.
