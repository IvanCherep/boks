# boks Local Environment Runbook

From nothing to a working local boks: a reader you can use, an admin you can
sign in as, and email you can actually read. Then every trap that is not
visible from the code, each one written down because a session hit it.

`docs/local-agent-infrastructure.md` describes the services and the deploy
path. This describes getting them to work on a laptop, which is a different
problem.

---

## The short version

```bash
npm ci                      # from the repository root
npx supabase start          # Postgres, Auth, REST, and the local mailbox
npm run dev                 # http://localhost:5173, against the local stack
```

Then create an admin (§3) and sign in through the local mailbox (§4).

`npm run dev` is the only command that talks to the local stack. `npm run
build`, `npm run start` and `npm run deploy` all talk to **production**
Supabase - see §1.

---

## 1. Which backend am I talking to?

Two env files, and the difference is not cosmetic. A build pointed at the
wrong one has already shipped to production once.

| File | Backend | Read by |
|---|---|---|
| `.env.local` | production Supabase | `build`, `start`, `deploy`, `verify:supabase` |
| `.env.development.local` | local stack | `dev` **only** |

**Before `npm run dev`, verify that `.env.development.local` actually exists and names the local stack.** It is ignored by Git and absent in a fresh checkout; without it, dev can fall back to the production values in `.env.local`. Create the development file from the running local stack without printing credentials, and verify the served page's service origin before exercising writes.

Vite picks env files by mode. `.env.development.local` applies only in dev, so
it can never reach a production bundle. That is the whole reason it has that
name.

**Never create `.env.production.local`.** Vite gives it priority over
`.env.local` in a production build. A session created it so that
`npm run start` would serve the local stack, and the next `npm run deploy`
shipped a bundle configured with `http://127.0.0.1:54321`. The site looked
healthy to the one person whose laptop was running Supabase and was broken for
everyone else - no feed, no sign-in, no email - and nothing noticed, because
every check passed: the code was right and only its address was wrong.

`npm run deploy` now runs `check:deploy-target`, which reads the built artifact
and refuses to ship a bundle naming a loopback service origin. To check a build
by hand:

```bash
npm run build && npm run check:deploy-target
```

If you need the *built* Worker against the local stack, prefer `npm run dev`.
If you truly need `npm run start`, pass the env inline rather than creating a
file that outranks production:

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321 \
VITE_SUPABASE_PUBLISHABLE_KEY=$(grep '^VITE_SUPABASE_PUBLISHABLE_KEY' .env.development.local | cut -d= -f2) \
npm run start
```

---

## 2. The local mailbox

Auth is passwordless, so without somewhere to read email you cannot sign in at
all. `supabase/config.toml` enables a local mail catcher:

```toml
[local_smtp]
enabled = true
port = 54324
```

`npx supabase start` should create it as `supabase_inbucket_fd`, and Auth is
configured to deliver to `supabase_inbucket_fd:1025`.

**If the container does not exist** - it was missing on this machine, from a
stack started before that config - Auth silently delivers nowhere. Symptom: the
app says "Check your email" and no email exists. Run any SMTP catcher under
that name on the Auth network:

```bash
docker run -d --name supabase_inbucket_fd \
  --network supabase_network_fd -p 54324:8025 \
  axllent/mailpit:latest
```

Mailbox UI: **http://127.0.0.1:54324**

Reading the newest link without opening a browser:

```bash
ID=$(curl -s 'http://127.0.0.1:54324/api/v1/messages?limit=1' \
  | python3 -c 'import json,sys; m=json.load(sys.stdin)["messages"]; print(m[0]["ID"] if m else "")')
curl -s "http://127.0.0.1:54324/api/v1/message/$ID" | python3 -c '
import json,sys,re
d=json.load(sys.stdin)
print(re.findall(r"http://[^\s\"<>]+verify[^\s\"<>]*", (d.get("Text") or ""))[0].replace("&amp;","&"))'
```

Clear it between tests: `curl -s -X DELETE http://127.0.0.1:54324/api/v1/messages`

### The mail catcher is bypassed by default

`config.toml` also carries the pilot's real SMTP:

```toml
[auth.email.smtp]
enabled = true
host = "smtp.resend.com"
pass = "env(RESEND_API_KEY)"
```

That block wins over the local catcher, and `RESEND_API_KEY` is not set on a
development machine. So a fresh `npx supabase start` gives you an Auth that
tries Resend with an empty password and fails:

```
POST /auth/v1/otp
{"code":500,"error_code":"unexpected_failure","msg":"Error sending magic link email"}
```

Nothing reaches Mailpit, because Auth never got that far. Two ways out:

1. **Export the key** before starting the stack, if you have it, and real email
   is sent to a real address.
2. **Switch the block off for local work** - `enabled = false`, then
   `npx supabase stop && npx supabase start`, and mail lands in Mailpit again.

If you take option 2, **restore `enabled = true` before you finish**, and never
run `npx supabase config push` while it is false: that pushes the flag and turns
off production email delivery. Keep a copy first
(`cp supabase/config.toml /tmp/config.toml.bak`) and diff on the way out.

The setting is read at container start, so editing the file is not enough - the
stack has to be restarted for Auth to notice.

---

## 3. Getting an admin account locally

Admin lives in `user_profiles.role`. There is no reader-accessible first-admin
claim: bootstrap is an operator action, and every later grant comes from an
existing admin in `/admin`. The local database usually already has an admin
from the flow tests.

Create one directly - local only, never a pattern for production:

```bash
SVC=$(npx supabase status -o json | python3 -c 'import json,sys; print(json.load(sys.stdin)["SERVICE_ROLE_KEY"])')
curl -s -X POST "http://127.0.0.1:54321/auth/v1/admin/users" \
  -H "apikey: $SVC" -H "Authorization: Bearer $SVC" -H "Content-Type: application/json" \
  -d '{"email":"admin@boks.local","email_confirm":true}' > /dev/null

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "
insert into user_profiles (user_id, handle, role, terms_accepted_at, terms_version)
select id, public.generate_boks_handle(public.boks_handle_seed_from_email(email), id), 'admin', now(), 'v1'
from auth.users where email = 'admin@boks.local'
on conflict (user_id) do update set role = 'admin';"
```

Then sign in: open the app, the boks wordmark, **Sign in**, that address, and
open the link from the mailbox on the same browser.

---

## 4. Signing in, and why it sometimes does nothing

**Request the link from the UI, never by calling `/auth/v1/otp` yourself.** The
browser client uses PKCE and stores the verifier in that browser's storage; a
link minted outside it cannot be completed.

The same email also carries a **6-digit code**, for entering in the requesting
app or home-screen installation. `supabase/config.toml` sets `otp_length = 6`
and loads both `supabase/templates/magic-link.html` and
`supabase/templates/confirmation.html`; first sign-ins use the confirmation
template. An older running Auth container may still send eight digits or only
a link. Recreate the local stack with the current config (preserving the local
SMTP choice in §2), then request a fresh email through the UI. Editing the file
alone does not change the running service. Never widen the reader's input or
verify a longer code through an API to work around a mismatched local config.

Three things that look like bugs and are not:

- **One email per address per minute.** `auth.email.max_frequency = "1m0s"`.
  A second request inside the minute is dropped and **no email appears** - the
  API still answers 200. The UI now disables the button and counts down, but a
  curl will hit this silently.
- **The link is single use** and expires. A used link shows a recoverable
  sign-in prompt, not an error page.
- **`redirect_to` must be in the allow list, and paths need a glob.**
  `additional_redirect_urls` entries match exactly, so `http://localhost:5173`
  permits the bare origin only; a link asked to return to `/admin` is silently
  replaced by `site_url`. The `/**` forms are in `config.toml` for this reason.
  Verified against the local GoTrue: the bare origin is honoured, the same
  origin with a path is not.

Config changes under `[auth]` need a push to reach production, and that needs
the Resend key:

```bash
set -a; . ./.env.resend; set +a
npx supabase config push --project-ref vcmrvnihbptostnzaean
```

Keep the key in `.env.resend` (covered by `.env*` in `.gitignore`). Never print
it, commit it, or paste it into a chat.

---

## 5. Migrations: three databases, and they are not the same one

This is the trap that costs the most time. There are three places schema can
live, and the commands do not do what their names suggest.

| Command | Which database |
|---|---|
| `npm run verify:schema` | a **throwaway** Postgres container, created and destroyed per run |
| `npm run test:supabase` | the **running local stack**, after `supabase db reset` |
| `bash deploy/migrate.sh` | **production** (our server, since 2026-11-07) |
| `npx supabase db push --linked` | the **retired** Supabase Cloud project, a backup only: never for production |

So: **`npm run verify:schema` passing does not mean your migration is in the
local stack.** A new RPC will be missing from the running app, and the failure
reads as "function does not exist" from the browser.

Apply a new migration to the running local stack without a full reset:

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -f supabase/migrations/<file>.sql
```

Then **reload the API schema cache**, or PostgREST will keep answering
`PGRST202 Could not find the function`:

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -c "notify pgrst, 'reload schema';"
```

**`npm run test:supabase` resets the local database.** It runs
`supabase db reset`, which reapplies every migration and destroys all local
data - including the admin account from §3 and any fixtures you added. Expect
to recreate them. It is still the right command for verifying flows; just know
what it costs.

Before touching production schema:

```bash
bash deploy/migrate.sh          # dry run: lists what production does not have, and the SQL
```

### Schema goes first, then the Worker

`npm run deploy` ships the client; it knows nothing about migrations. Deploying
a client that expects a column or an RPC field the production database does not
have yet leaves production broken in a way no gate catches: `verify:schema`
passes, `test:supabase` passes, `check:deploy-target` passes, and the deploy
succeeds. The reader sees `undefined` where a count should be, or a submission
refused by a rule the form no longer shows.

This has already happened once: the submission-form change was deployed while
`20260915180000_boks_simpler_submission.sql` was still local-only. So, in this
order, every time:

```bash
bash deploy/migrate.sh           # must list nothing pending
bash deploy/migrate.sh --apply   # only if it does
npm run deploy
```

`bash deploy/migrate.sh` before a deploy is the cheap check
(`docs/agents/production-changes.md` -> Schema).

---

## 6. Verification, and what each gate can actually see

```bash
npm run lint          # no services needed
npm run typecheck     #
npm test              # pure unit tests, no database
npm run build         #
npm run verify:schema      # needs Docker; throwaway Postgres, 100+ assertions
npm run test:supabase      # needs the local stack; RESETS it
npm run verify:divergence  # needs a reachable Supabase; can the live arms resolve anything
npm run verify:supabase    # needs .env.local; checks production behaviour
npm run check:deploy-target # needs a build; refuses a locally-pointed bundle
```

If a gate cannot run, say which one and why. Do not report it as passing.

---

## 7. Testing the UI

The Chrome extension drives the founder's own browser, so it reaches both
`localhost` and production.

Two limitations found in practice:

- **`resize_window` often does not change the viewport.** `innerWidth` stays
  whatever it was, so a phone-width check silently tests the desktop layout.
  Check `innerWidth` before trusting a mobile screenshot.
- To look at the mobile layout at a wide viewport, apply the app's own
  breakpoint rules rather than invented ones - pull the rules out of
  `document.styleSheets` for the `max-width: 720px` block and re-apply them.
  Inventing approximations produced a "bug" that did not exist: the action rail
  appeared to overlap the byline only because the simulation had moved it.

The reader hides its chrome after about five seconds. To inspect it, remove
`reader-shell--focus` from `.reader-shell` rather than waiting.

Signing out on production logs the founder out of their own admin console, and
getting back in depends on email delivery that may not work. Do not click it to
"test" it.

---

## 8. Email delivery: the real constraint

The sender is `hello@tryboks.com` on the Resend-verified `tryboks.com`
domain (DKIM and a custom return path are published; DMARC is not yet). The
constraint now is volume, not delivery: check the Resend plan's **daily** cap
before a large invite wave - one wave plus the "send again" taps can reach it.
Replies to `hello@` bounce until it has an Email Routing rule; `support@` is
routed.

### `supabase config push` and the `env()` credential

`[auth.email.smtp] pass = "env(RESEND_API_KEY)"` resolves against whatever
shell runs the command. `supabase config diff` reports the password as
**masked** - the API never returns it, so the diff cannot tell you whether a
push would change it - which means pushing from a shell without the key set
risks writing an empty password and stopping production email. The diff will
not warn you.

So a push needs the key:

```bash
RESEND_API_KEY=... npx supabase config push --yes
```

If you only need to change something else in `[auth]` and do not have the key,
`config push` leaves undeclared properties untouched: comment the whole
`[auth.email.smtp]` block out, confirm with `supabase config diff` that every
`smtp` path now reads `declared: false` and only your intended property is
`declared: true`, push, then restore the block. Verified to work - the diff
moves all seven smtp properties to `remote_only, declared: false`.

Always read `supabase config diff` before a push. The command proceeds by
default when run non-interactively, and the file declares a `site_url` and
several toggles that would otherwise overwrite hosted settings.

---

## 9. When something is broken, check these first

| Symptom | Likely cause |
|---|---|
| "Check your email" and no email | mail catcher container missing (§2), or the one-per-minute throttle (§4) |
| `PGRST202 Could not find the function` | migration not applied to the running stack, or schema cache not reloaded (§5) |
| App works for you, nobody else | bundle built against the local stack (§1) - run `check:deploy-target` |
| Admin link lands on the reader | `redirect_to` path not in the allow list (§4) |
| Admin account gone after tests | `test:supabase` reset the database (§5) |
| Sign-in link "already used or expired" | single use; request another, mind the throttle |
| Local data looks wrong after a rebase | migrations reapply on reset; fixtures are not migrations |
