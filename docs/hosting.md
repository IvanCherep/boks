# boks Hosting Guide

## Current Hosting Shape

boks is hosted on Cloudflare Workers with Static Assets.

Current public URL:

`https://tryboks.com`

Cloudflare naming:

- Account `workers.dev` subdomain: `tryboks`
- Production Worker name: `read`
- Final free URL pattern: `<worker-name>.<account-subdomain>.workers.dev`
- Old public routes for `boks` and `boks-prototype` should stay disabled.

The production config lives in `wrangler.jsonc`. The local Sites manifest lives in `.openai/hosting.json`.

Cloudflare references:

- Workers routes and `workers.dev`: `https://developers.cloudflare.com/workers/configuration/routing/workers-dev/`
- Wrangler configuration: `https://developers.cloudflare.com/workers/wrangler/configuration/`

## Environment Variables

Local development and deployment need `.env.local`, copied from `.env.example`.

Required public values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Never store or deploy a Supabase service role key for browser code. Do not put service role keys in source, screenshots, Wrangler vars, or docs.

Supabase Auth should allow:

- anonymous sign-ins for guest reading;
- email sign-up/sign-in for permanent reader accounts;
- email confirmation and leaked-password protection, including for callers
  that bypass the passwordless boks UI;
- production redirect URL `https://tryboks.com`, with the workers.dev origin
  kept on the allow-list while live links still name it;
- no manual identity linking. Guest history is joined by the stable browser
  visitor id, while Supabase creates a fresh permanent identity from the link.

## Email Delivery

boks uses Supabase magic links for all user-facing authentication. For a real
pilot, configure custom SMTP in Supabase Auth before inviting external testers.
Supabase's default email sender is only for early exploration: it is limited,
can refuse delivery to non-team addresses, and is currently capped at a very low
hourly volume. When it fails, the app may receive `Error sending magic link
email` from Supabase.

Recommended setup:

- Use a transactional provider such as Resend, Postmark, SendGrid, Brevo, or AWS
  SES.
- Configure it in Supabase dashboard under `Authentication -> SMTP`.
- Keep auth email separate from marketing email.
- Add SPF, DKIM, and DMARC for the sending domain before a conference or larger
  test.
- Raise the Supabase Auth email rate limit only after custom SMTP is active.

Current pilot state:

- Supabase Auth is configured to use Resend SMTP.
- The sender is `hello@tryboks.com` (`[auth.email.smtp].admin_email` in
  `supabase/config.toml`) on the Resend-verified `tryboks.com` domain, with
  DKIM at `resend._domainkey.tryboks.com` and the return path on
  `send.tryboks.com`. Mail *to* `hello@` has no Email Routing rule yet, so a
  reply bounces; `support@tryboks.com` is routed (`docs/project-state.md`).
- There is no DMARC record yet. Add one before a large invite wave.
- Keep the Resend API key out of source. Push it with
  `RESEND_API_KEY=<secret> npx supabase config push --project-ref <project-ref>`.

Use `supabase config diff` before pushing config. Do not run a full config push if it would overwrite unrelated remote settings such as SMS/provider configuration.

## Deploy

Before deploy, from a clean tree:

```bash
git status --short
npm run lint && npm run typecheck && npm test
npm run verify:schema          # when migrations changed
npx supabase db push --linked --dry-run   # when migrations changed: lists exactly what production will get
```

Apply migrations **before** deploying code that depends on them, and only
forward migrations that old code also survives - a deploy is not atomic with
the database, and tabs already open run the old client for a while.

Deploy:

```bash
npm run deploy
```

The deploy command builds the app, refuses a bundle that points at a local backend (`npm run check:deploy-target`), and runs:

```bash
wrangler deploy --config wrangler.jsonc --keep-vars
```

`--keep-vars` matters because Cloudflare dashboard variables must not be deleted by a deploy that only includes source config.

The Worker CPU cap is 3000ms. Ordinary feed/page requests remain below it;
`/b/[id]/image` also renders a portrait PNG on cache miss. The image uses the
registered cover's native 720px width and a five-minute Worker cache. Outgoing
responses are private/no-store so CDN hits cannot skip publication checks.
The original 1000ms cap caused `exceededCpu` on cold 1080px renders in production;
local Wrangler rendering alone did not expose this limit.

## Verify Production

Run:

```bash
curl -I https://tryboks.com/
curl -I https://tryboks.com/admin
curl -I https://tryboks.com/series
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://tryboks.com/api/feed
curl -s https://tryboks.com/api/geo
```

Expected:

- `/`, `/admin` and `/series` return `200`.
- `POST /api/feed` without a session returns `401` - the feed needs the
  reader's Supabase token; a real slate is checked in the browser.
- `/api/geo` returns a two-letter country (or nothing) with `no-store`.
- HTML responses include CSP, HSTS, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, Referrer-Policy, and Permissions-Policy.

Then open these routes in a browser:

- `https://tryboks.com/`
- `https://tryboks.com/admin`
- `https://tryboks.com/author`

Check browser console for runtime errors.

## Cloudflare Dashboard Checks

In Cloudflare dashboard, open:

`Workers & Pages -> read -> Domains`

Expected:

- Production Worker URL: enabled.
- Production URL: `tryboks.com` (custom domain on the `read` Worker). The
  workers.dev host `read.tryboks.workers.dev` serves the same Worker and is
  kept alive by `"workers_dev": true` in `wrangler.jsonc` - omit that flag and
  a `triggers deploy` silently 404s it.
- Preview URLs: optional; keep enabled only if useful for manual version checks.
- Custom domains: `tryboks.com` only (`docs/adr/0010-apex-only-origin.md`).
- Routes: none.

In `Workers & Pages`, old Workers may appear:

- `boks`
- `boks-prototype`

They can remain as rollback references, but their public `workers.dev` routes should stay disabled. Delete them only after a deliberate cleanup decision.

## DNS Notes

After changing the account `workers.dev` subdomain, DNS and TLS can lag for several minutes. During that window:

- Cloudflare dashboard may already show the correct URL.
- Public resolvers may be inconsistent.
- A local Mac or browser may show `ERR_NAME_NOT_RESOLVED`.

Check public DNS:

```bash
dig @1.1.1.1 +short tryboks.com A
dig @8.8.8.8 +short tryboks.com A
```

If Cloudflare dashboard shows the Worker URL enabled and public DNS eventually resolves, wait before changing config again.

## Rollback

Repair forward from current source, with a focused revert if needed. Never roll the Worker back alone: production schema has moved on and older code can break against it.

Do not change the account `workers.dev` subdomain again unless the URL strategy changes. It affects every Worker under the account.

If `tryboks.com` fails after a deploy:

1. Check `wrangler deployments list --config wrangler.jsonc`.
2. Check `Workers & Pages -> read -> Deployments`.
3. Check `Workers & Pages -> read -> Domains`.
4. Correct the current source and run its validation gates.
5. Re-run `npm run deploy` with code compatible with the current production schema; keep `--keep-vars`.

## The Supabase Pro Plan, and What It Must Not Cost

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

### What the Advisors found the first time we read them

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

## Signing In With A Code

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
