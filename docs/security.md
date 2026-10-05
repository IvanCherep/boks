# boks Security Model

Updated 2026-09-26 after the full application and Supabase audit.

## Trust Boundaries

- Browser input is untrusted, including a valid reader session. Identity and
  role decisions are made by Supabase Auth, RLS, and narrowly scoped RPCs.
- The publishable Supabase key is public by design. It grants no authority by
  itself; every exposed table, view, and function must be justified by grants
  plus RLS or an internal authorization check.
- The service role and `EMBED_KEY` exist only in Supabase Edge Function
  secrets. They must never enter the repository, Worker variables, browser,
  logs, screenshots, or documentation.
- Recommendation attribution is server-owned. Reader routes never accept an
  algorithm override; experiment configuration is an admin operation.

## Implemented Controls

- Dependencies are exact-version pinned. `npm audit` is a release gate.
- The Worker applies CSP, HSTS on HTTPS, `nosniff`, frame denial, a restrictive
  referrer policy, and a permissions policy through `proxy.ts`.
- JSON API bodies are stream-limited to 256 KiB, including chunked requests.
  Public errors never return database or PostgREST messages.
- `/api/feed` accepts only bounded bearer tokens with a UUID subject. Supabase
  still verifies the JWT signature before any data is read or written.
- There is no second data path: the D1 compatibility route was removed on
  2026-10-05 (`docs/adr/0013-remove-d1-compatibility-path.md`).
- `record_served_feed` and `record_recommendation_events` enforce batch, row,
  metadata, payload, and per-account hourly limits in PostgreSQL. The unchecked
  implementations are not executable by browser roles.
- Social and author writes require a permanent, non-blocked account with
  accepted terms. The write trigger is defense in depth beneath RPC and RLS.
- Bare `anon` cannot write feedback or journey telemetry. A guest first obtains
  a rate-limited anonymous Supabase session, which uses the `authenticated`
  database role.
- Admin bootstrap is operator-only. A reader cannot claim the first admin;
  existing admins grant and revoke the role from `/admin`.
- Email confirmation, leaked-password protection, and password minimums remain
  enabled even though the product exposes only magic-link authentication.
- Data API table grants are deny-by-default and asserted in
  `scripts/local-supabase/checks.sql`.

## Release Checks

Run before a security-sensitive deployment:

```bash
npm audit
npm run lint
npm run typecheck
npm test
npm run verify:schema
npm run verify:supabase
npm run build
npx supabase db advisors --linked --type all --level warn --fail-on none
```

Database changes go first: `supabase db push --linked --dry-run`, review the
single expected migration, push it, run `verify:supabase`, then deploy the
Worker. After deployment, inspect response headers and test `/`, `/admin`, the
reader API, a magic-link request, comments, likes, and an admin-only RPC.

## Advisor Exceptions And Residual Risk

- `published_boks`, `boks_comments`, and `boks_public_identity` intentionally
  remain security-definer views. They are narrow public projections; changing
  them to invoker views would require granting access to wider base tables.
  All view writes are revoked and tested.
- Anonymous sign-in is intentional because reading starts without account UI.
  Database write limits and Supabase Auth IP limits contain abuse. Turnstile is
  the next control before a public campaign; it needs a managed site/secret and
  client token integration, so it is not enabled as a hidden deployment-only
  change.
- The CSP currently needs `'unsafe-inline'` for vinext's inline RSC bootstrap.
  External scripts remain blocked. Replace this with nonce/hash support when
  the framework exposes a stable mechanism.
- Six `anon` security-definer functions remain intentionally executable. They
  return public catalogue/comment/account context only and perform no writes.
  Every write-oriented function requires an authenticated Supabase session.
- Direct browser-to-Supabase traffic can still fail on networks that block the
  Supabase hostname. That is an availability risk, not an authorization bypass;
  see `docs/project-state.md` for the proxy/custom-domain options.

## Incident Rules

1. Rotate any API key pasted into chat, issue trackers, screenshots, or logs.
2. Suspend a compromised user before investigating; stale JWTs are blocked by
   the database tombstone/ban checks.
3. Preserve database and Auth logs before deleting data.
4. Never roll back only the Worker when its expected migration is already live.
5. Record a fixed vulnerability in a migration/test/doc together so a later AI
   agent cannot reopen it accidentally.
