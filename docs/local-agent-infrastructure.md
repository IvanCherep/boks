# boks Local Agent Infrastructure Guide

This guide is for a local AI coding assistant such as Claude Desktop, Cursor,
Codex CLI, or any terminal-capable agent running on the founder's Mac. It
explains the infrastructure behind boks and the exact operational path for
testing and deploying the application.

## Repository

Run every command from the repository root. Read `AGENTS.md` first and follow
its read order; for deployment, `docs/hosting.md`; for any auth, API,
dependency, RLS, RPC or deployment-boundary change, `docs/security.md`.

Before editing:

```bash
git status --short
```

The worktree may contain human or agent changes. Do not revert unrelated files.

## Product Shape

boks is a browser MVP for a literature-only, swipe-first reading feed.

Core product rules:

- A bok is one content unit (`CONTEXT.md`), similar to one reel in Instagram.
- Readers do not choose genre, mood, catalog item, or recommendation algorithm.
- The main page is algorithmic and reading-focused.
- Guests can read a limited number of boks before sign-up is required.
- Likes and writing comments require a permanent account.
- Guests can read comments.
- Comments display the signed-in account's unique `@handle`.
- Every user can submit boks, but admin approval is required before publication.
- User authentication is passwordless: Supabase email OTP - a magic link or the 6-digit code from the same email.

## Services

### Cloudflare Workers

Cloudflare hosts the production browser app.

Current production URL:

```text
https://tryboks.com
```

Cloudflare naming:

- Account `workers.dev` subdomain: `tryboks`
- Worker name: `read`
- URL pattern: `<worker-name>.<workers-dev-subdomain>.workers.dev`

Important files:

- `deploy/release.sh`: the release (`npm run deploy`); `deploy/ops/switch.sh`
  switches the server to it with no downtime.
- `deploy/compose.yml`, `deploy/Caddyfile`: the server stack.
- `dist/`: generated build output, do not edit by hand.

Deploy command (production is our own server since 2026-11-07, not the Worker):

```bash
bash deploy/migrate.sh   # when migrations changed: dry run, then --apply
npm run deploy
```

It checks, builds the Node server, refuses a bundle that names a local
backend (`check:deploy-target`), uploads it and switches the two app copies
one at a time; `docs/hosting.md` -> Deploy has the details and the rollback.

`check:deploy-target` reads the built artifact and refuses to deploy a bundle
that names a loopback service origin, or one that names no backend at all. It
exists because a local override once shipped to production: the site reached
`http://127.0.0.1:54321`, which resolved only on the founder's laptop, so it
looked healthy to one person and was broken - feed, sign-in and email - for
everyone else. Every other check passed, because the code was right and only
its address was wrong.

If the agent cannot deploy:

1. Confirm it is running in the project root, with dependencies installed.
2. Confirm `ssh boks-app true` works. Access is an SSH key added on the
   server (`docs/onboarding.md`); an agent cannot grant it: ask the founder.
3. Read the failing step's output; `bash deploy/release.sh --list` shows what
   is live. Retry `npm run deploy` after fixing the cause.

Do not rename the Cloudflare `workers.dev` subdomain unless the founder
explicitly requests a URL strategy change. It affects all Workers in the
account.

### Supabase

Supabase is the production MVP backend.

Supabase responsibilities:

- anonymous reader sessions;
- permanent passwordless email accounts;
- `user_profiles` with roles and unique `@handle`;
- published boks content;
- comments, likes, views, and reader events;
- author submissions and admin moderation;
- recommendation experiment assignments and metrics;
- admin RPCs and RLS-enforced access.

Important files:

- `supabase/config.toml`: local Supabase/Auth/SMTP config.
- `supabase/migrations/`: production schema history.
- `components/boks/supabase-browser-data.ts`: browser-safe Supabase data access.
- `lib/boks/supabase-client.ts`: browser Supabase client and magic-link handling.
- `scripts/verify-supabase-mvp.mjs`: production Supabase behavior verification.

The frontend must use only:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Never expose a Supabase service role key in source, browser code, docs,
screenshots, Wrangler vars, or console output.

Local verification command:

```bash
npm run verify:supabase
```

Before changing database schema:

```bash
npx supabase --version
npx supabase migration new <short_descriptive_name>
```

Then edit the new migration under `supabase/migrations/`, update verification
scripts, and run:

```bash
npm run verify:supabase
npx supabase migration list --linked
```

Use a dry run before applying linked migrations:

```bash
npx supabase db push --linked --dry-run --yes
```

Only apply migrations after reviewing the SQL and RLS impact.

### Supabase Auth

boks uses passwordless email magic links.

Production Auth rules:

- Confirm email is enabled.
- Manual identity linking is disabled; browser visitor identity preserves the
  guest-to-account funnel.
- Leaked-password protection is enabled as defense in depth for direct Auth API
  clients, even though boks has no password UI.
- Anonymous sign-ins remain enabled. Guest writes require that anonymous
  Supabase session; the bare `anon` role is read-only.

Run `npx supabase config diff` before every `config push`. Undeclared remote
properties are preserved, but declared local rate limits are authoritative.

Current rules:

- No password fields.
- No password reset UI.
- Sign-up/sign-in uses `supabase.auth.signInWithOtp`.
- Browser client uses PKCE magic-link flow.
- Redirect URL must include:
  ```text
  https://tryboks.com
  ```

Auth-related files:

- `components/boks/user-auth-panel.tsx`
- `components/boks/reader-feed.tsx`
- `components/boks/admin-dashboard.tsx`
- `lib/boks/supabase-client.ts`
- `supabase/config.toml`

When testing magic links:

1. Open `https://tryboks.com`.
2. Open the boks account panel.
3. Use Sign up or Sign in.
4. Request a magic link from the UI, not by manually calling the OTP endpoint,
   because PKCE stores verifier state in the browser.
5. Open the link on the same browser/device.
6. Confirm the URL is cleaned after redirect.
7. Confirm the user is signed in or sees a gentle expired-link recovery flow.

### Resend SMTP

Supabase Auth sends sign-in email (link and code) through Resend SMTP.

- SMTP host `smtp.resend.com`, user `resend`, password from `RESEND_API_KEY`.
- Sender `hello@tryboks.com` (`[auth.email.smtp].admin_email` in
  `supabase/config.toml`), on the Resend-verified `tryboks.com` domain.
- Replies to `hello@` bounce until it gets an Email Routing rule;
  `support@tryboks.com` is routed to the owner. DMARC is not published yet.

Change SMTP settings in the Supabase dashboard. `supabase config push`
overwrites the SMTP password unless `RESEND_API_KEY` is in the shell
environment, so run `supabase config diff` first and never push without it:

```bash
RESEND_API_KEY=<secret> npx supabase config push --project-ref <project-ref>
```

Never write the Resend API key into docs, source, screenshots, or chat logs.
If a key was pasted into a chat, treat it as exposed and rotate it.

### OpenAI Sites Metadata

The repository contains:

```text
.openai/hosting.json
```

This is metadata from the original Sites flow. For the current live app,
Cloudflare Workers deployment is the production path:

```bash
npm run deploy
```

Do not use Sites as a workaround unless the founder explicitly changes the
hosting plan.

## Local Environment

Local files:

- `.env.local` - the Supabase Cloud project (production until 2026-11-07,
  now a backup). Used by `build` and `verify:supabase`; `npm run deploy` does
  not read it, it sets the production values itself (`deploy/release.sh`).
- `.env.development.local` - the local Supabase stack. Vite reads it in *dev
  mode only*, so it can never reach a production build.

Never create `.env.production.local`. Vite gives it priority over `.env.local`
in a production build, which is exactly how a local address reached production.
`check:deploy-target` now catches it, but the file should not exist.

These files may exist on the founder's machine and must stay uncommitted.
Agents can read them locally when needed, but must not print secrets in final
answers, logs, screenshots, docs, or commits.

Required values for normal development:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Install dependencies:

```bash
npm ci
```

Run local development:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Run the built Worker locally:

```bash
npm run start
```

## Validation Before Deploy

Minimum checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

When Supabase behavior changed:

```bash
npm run verify:supabase
```

When recommendation algorithms changed:

```bash
npm run verify:divergence
```

When schema changed:

```bash
npm run verify:schema
```

Some checks need Docker or a linked Supabase project. If a check cannot run,
state the exact reason and do not pretend it passed.

## Production Verification After Deploy

Run:

```bash
curl -I https://tryboks.com/
curl -I https://tryboks.com/admin
curl -I https://tryboks.com/author
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://tryboks.com/api/feed
```

Expected:

- `/`, `/admin`, and `/author` return `200`.
- `POST /api/feed` without a session returns `401`.
- Admin browser UI requires an admin Supabase role for private metrics.

For auth work, also test in Chrome:

- request a sign-in email from the boks UI;
- open the link on the same browser, and separately sign in with the code;
- verify the app cleans the redirect URL;
- verify old/used links show a recoverable sign-in experience rather than a
  broken global error.

Pitfalls when an agent drives the reader through the Chrome extension
(learned 2026-09-19):

- **The screenshot frame is not the viewport.** Screenshots can report a frame
  of ~1531-1547px wide while `innerWidth` is 1470, and the frame changes
  between calls. Clicks are scaled from the frame, so a coordinate read off a
  screenshot can land a few pixels off - next to the rail, on the reader's
  right edge, which turns the page. Take the element's centre from
  `getBoundingClientRect()` and multiply by `frameWidth / innerWidth`. Clicking
  by `ref` from `find` misses the same way; do not use it for the rail.
- **The tab is often `document.visibilityState === "hidden"`.** Input may not
  arrive at all until a screenshot brings the tab forward, and React commits
  late. Wait ~3s between a tap and reading state back, and log `pointerdown`
  to confirm an input was delivered before debugging the app.
- **A tap within 150ms of a scroll is ignored by design** (it stops a flick).
  Taking a screenshot can fire a scroll event, so the first tap after one may
  do nothing.
- **Test likes are real rows.** Remove them through the UI afterwards (open the
  boks at `/b/<id>`, tap the filled heart) and confirm with `get_bok_reactions`.

## Admin Access

Admin role lives in Supabase `user_profiles.role`.

Rules:

- Admin access is granted only through the admin panel after at least one admin
  exists.
- Browser local storage, URL flags, and `user_metadata` are not authorization.
- RLS/RPC checks must enforce admin-only operations.

There is no reader-accessible first-admin claim: bootstrapping the first admin
is an operator action (`docs/security.md`, `docs/local-environment-runbook.md`).
After that, use the admin UI to grant the role to another permanent account.

## Operational Safety

Claude or any local agent must follow these rules:

- Do not commit secrets.
- Do not print secret values.
- Do not delete old Cloudflare Workers without explicit cleanup approval.
- Do not change the production URL without explicit approval.
- Do not bypass Supabase RLS with broad service-role code.
- Do not add passwords back into the UX.
- Do not add reader genre/mood pickers or story catalogs.
- Do not deploy without at least `lint`, `typecheck`, and `build`.
- If production deploy succeeds, report the public URL and the checks run.
- If deploy fails, report the concrete blocker and leave source changes intact.

## Deploy

Follow `docs/hosting.md` -> Deploy. The final response should say what
changed, which checks passed (and which could not run, and why), whether
production was deployed and which Worker version is live, and any unresolved
operational risk - especially email delivery or migration state.
