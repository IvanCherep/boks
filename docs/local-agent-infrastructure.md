# boks Local Agent Infrastructure Guide

This guide is for a local AI coding assistant such as Claude Desktop, Cursor,
Codex CLI, or any terminal-capable agent running on the founder's Mac. It
explains the infrastructure behind boks and the exact operational path for
testing and deploying the application.

## Repository

Project root:

```bash
/Users/iegorov/Documents/Codex/2026-09-09/fd
```

Read these first:

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/ai-agent-guide.md`
4. `docs/hosting.md`
5. The focused spec for the change:
   - `specs/boks-product-spec.md`
   - `specs/boks-recommendation-experiments.md`

Before editing:

```bash
git status --short
```

The worktree may contain human or agent changes. Do not revert unrelated files.

## Product Shape

boks is a browser MVP for a literature-only, swipe-first reading feed.

Core product rules:

- A `bok` is one content unit, similar to one reel in Instagram.
- Readers do not choose genre, mood, catalog item, or recommendation algorithm.
- The main page is algorithmic and reading-focused.
- Guests can read a limited number of boks before sign-up is required.
- Likes and writing comments require a permanent account.
- Guests can read comments.
- Comments display the signed-in user's unique `@nickname`.
- Every user can submit boks, but admin approval is required before publication.
- User authentication is passwordless: Supabase email magic links only.

## Services

### Cloudflare Workers

Cloudflare hosts the production browser app.

Current production URL:

```text
https://read.tryboks.workers.dev
```

Cloudflare naming:

- Account `workers.dev` subdomain: `tryboks`
- Worker name: `read`
- URL pattern: `<worker-name>.<workers-dev-subdomain>.workers.dev`

Important files:

- `wrangler.jsonc`: production Worker config.
- `package.json`: deploy script.
- `dist/`: generated build output, do not edit by hand.

Deploy command:

```bash
npm run deploy
```

That runs:

```bash
npm run build
npm run check:deploy-target
wrangler deploy --config wrangler.jsonc --keep-vars
```

`check:deploy-target` reads the built artifact and refuses to deploy a bundle
that names a loopback service origin, or one that names no Supabase backend at
all. It exists because a local override once shipped to production: the site
reached `http://127.0.0.1:54321`, which resolved only on the founder's laptop,
so it looked healthy to one person and was broken - feed, sign-in and email -
for everyone else. Every other check passed, because the code was right and
only its address was wrong.

`--keep-vars` is required. It prevents Wrangler from deleting Cloudflare
dashboard variables during a source-only deployment.

If Claude cannot deploy:

1. Confirm it is running in the project root.
2. Confirm dependencies exist with `npm install` or `npm ci`.
3. Confirm Wrangler is authenticated:
   ```bash
   npx wrangler whoami
   ```
4. If not authenticated, run:
   ```bash
   npx wrangler login
   ```
   Complete the browser login as the Cloudflare account owner.
5. Retry `npm run deploy`.

Do not rename the Cloudflare `workers.dev` subdomain unless the founder
explicitly requests a URL strategy change. It affects all Workers in the
account.

### Supabase

Supabase is the production MVP backend.

Supabase responsibilities:

- anonymous reader sessions;
- permanent passwordless email accounts;
- `user_profiles` with roles and unique `@nickname`;
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

Current rules:

- No password fields.
- No password reset UI.
- Sign-up/sign-in uses `supabase.auth.signInWithOtp`.
- Browser client uses PKCE magic-link flow.
- Redirect URL must include:
  ```text
  https://read.tryboks.workers.dev
  ```

Auth-related files:

- `components/boks/user-auth-panel.tsx`
- `components/boks/reader-feed.tsx`
- `components/boks/admin-dashboard.tsx`
- `lib/boks/supabase-client.ts`
- `supabase/config.toml`

When testing magic links:

1. Open `https://read.tryboks.workers.dev`.
2. Open the boks account panel.
3. Use Sign up or Sign in.
4. Request a magic link from the UI, not by manually calling the OTP endpoint,
   because PKCE stores verifier state in the browser.
5. Open the link on the same browser/device.
6. Confirm the URL is cleaned after redirect.
7. Confirm the user is signed in or sees a gentle expired-link recovery flow.

### Resend SMTP

Supabase Auth sends magic-link emails through Resend SMTP.

Current pilot state:

- SMTP provider: Resend.
- SMTP host: `smtp.resend.com`.
- SMTP user: `resend`.
- Sender currently configured in `supabase/config.toml`:
  ```text
  onboarding@resend.dev
  ```

Important limitation:

- `onboarding@resend.dev` is a Resend sandbox sender.
- It is suitable only for very early testing.
- It may deliver only to the exact verified account-owner email.
- It is not suitable for 100-200 conference testers.

Before inviting outside testers:

1. Buy or connect a real sending domain.
2. Verify that domain in Resend.
3. Add SPF, DKIM, and DMARC DNS records.
4. Change Supabase SMTP sender to something like:
   ```text
   login@tryboks.com
   ```
5. Push Supabase config with the Resend API key supplied through the shell
   environment, not committed to source:
   ```bash
   RESEND_API_KEY=<secret> npx supabase config push --project-ref <project-ref>
   ```

Never write the Resend API key into docs, source, screenshots, or chat logs.
If a key was pasted into a chat, treat it as exposed and rotate it in Resend
before a real pilot.

### D1 Compatibility Path

The project still contains a Cloudflare D1 compatibility API from the original
prototype.

Files:

- `db/schema.ts`
- `drizzle/`
- `app/api/boks/route.ts`
- `lib/boks/analytics.ts`

Current role:

- local/demo fallback;
- compatibility reference for original event shapes;
- not the primary production user/auth store.

Do not move new MVP user/account/auth behavior into D1. Supabase is the
production MVP backend.

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

- `.env.local` - the production Supabase project. Used by `build`, `deploy` and
  `verify:supabase`.
- `.env.development.local` - the local Supabase stack. Vite reads it in *dev
  mode only*, so it can never reach a production build.
- `.env.local-supabase` - the same local values, kept for reference.

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
curl -I https://read.tryboks.workers.dev/
curl -I https://read.tryboks.workers.dev/admin
curl -I https://read.tryboks.workers.dev/author
curl 'https://read.tryboks.workers.dev/api/boks?view=reader&limit=3&visitorId=agent-live-check'
```

Expected:

- `/`, `/admin`, and `/author` return `200`.
- Reader API returns a bounded payload.
- Admin browser UI requires an admin Supabase role for private metrics.

For auth work, also test in Chrome:

- request a magic link from the boks UI;
- open the email link on the same browser;
- verify the app cleans the redirect URL;
- verify old/used links show a recoverable sign-in experience rather than a
  broken global error.

## Admin Access

Admin role lives in Supabase `user_profiles.role`.

Rules:

- Admin access is granted only through the admin panel after at least one admin
  exists.
- Browser local storage, URL flags, and `user_metadata` are not authorization.
- RLS/RPC checks must enforce admin-only operations.

If no admin exists, the app can expose an initial claim flow in `/admin`. After
one admin exists, use the admin UI to grant admin role to another permanent
user.

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

## Quick Deploy Checklist For Claude

From the project root:

```bash
git status --short
npm run lint
npm run typecheck
npm run build
npm run deploy
curl -I https://read.tryboks.workers.dev/
```

If Supabase changed:

```bash
npm run verify:supabase
```

Final response should include:

- what changed;
- what checks passed;
- whether production was deployed;
- the live URL;
- any unresolved operational risk, especially email delivery or Supabase
  migration state.
