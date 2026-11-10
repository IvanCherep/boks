# boks Security Model

Updated 2026-11-05; production includes the current author-cabinet migrations.

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
- Rights complaints are the exception to the permanent-account/Terms requirement:
  an anonymous Supabase session may call `report_bok` without account creation
  or consent. Reports remain private, one open report per reader/bok, and
  suspended accounts remain blocked. The forward migration
  `20261017200000_boks_guest_reports.sql` restores this documented rule without
  changing likes, comments, follows or author write gates.
- Bare `anon` cannot write reports, feedback or journey telemetry. A guest first obtains
  a rate-limited anonymous Supabase session, which uses the `authenticated`
  database role.
- Rights review pages reports and unattested boks independently before JSON
  aggregation, with a hard maximum of 200 rows per list. The authenticated
  `get_boks_rights_review_page` RPC checks the live admin role; its legacy wrapper
  is bounded as well. No new table privileges are granted.
- Admin bootstrap is operator-only. A reader cannot claim the first admin;
  existing admins grant and revoke the role from `/admin`.
- Email confirmation, leaked-password protection, and password minimums remain
  enabled even though the product exposes only magic-link authentication.
- Data API table grants are deny-by-default and asserted in
  `scripts/local-supabase/checks.sql`.
- Study tables (`20261026100000_boks_studies.sql`) have no Data API grants.
  Participants - anonymous sessions included - write only through RPCs that
  check the study's switch, that the participant row is the caller's, and a cap
  of 300 answers per participant at 128 KB each; nothing is written while a
  study is off. Answers, materials and fragment methods are readable only by
  admins (`is_boks_admin`), and a b3 rater never receives a fragment's method.

Shared poster images (`/b/[id]/image`) query one published bok with the public
key before consulting the five-minute Worker render cache. Fonts and artwork
come only from owned static assets; request input is never an asset URL.
Responses use private/no-store so the CDN cannot serve an image past the
publication check. Unknown or hidden boks return 404; render errors are 503 and
are not cached. The CPU cap is 3000ms, with 720px rendering to bound PNG work.

Author page name and photo (`author_pages`, 20261110100000) have no Data API
grants; `save_my_author_page` is the only write: a permanent, unsuspended
account, its own row, a name of at most 60 characters without `<`, `>` or
control characters, a photo that starts with the JPEG signature and is under
700 KB, and a version check so a stale tab cannot overwrite a newer save. The
browser crops and re-encodes the photo (dropping camera metadata) before
sending it. `/a/<handle>/photo` serves only those bytes as `image/jpeg` with
`nosniff`; a suspended account's page name and photo are not served.

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

Database changes go first: `bash deploy/migrate.sh` (dry run), review the
expected forward migrations, `--apply` them, then `npm run deploy`
(`docs/agents/production-changes.md`). The `--linked` advisor command above
reads the retired Supabase Cloud project, kept as a backup. After deployment, inspect response headers and test `/`, `/admin`, the
reader API, a magic-link request, comments, likes, and an admin-only RPC.

## Advisor Exceptions And Residual Risk

### 2026-11-05 asset release dependency audit

The recheck reports 21 findings in the full dependency tree (one critical,
three high, seventeen moderate), and three with `--omit=dev`: `next`,
`zod` and `fast-uri`. This is not a clean audit. The package versions have
not changed in this asset release; the October audit result below is a dated
record, not the current result.

The reported Next server Image Optimization/Server Actions/`use cache`
paths are not used: Vinext owns the Worker and resolves `next/*` to its
shims; the application has no `next/image`, `use server` or `use cache`.
The application does not import Zod or fast-uri (the latter is in the unused
form-resolver/Ajv dependency path). The deployed bundle must be checked for
those paths after building; a future import reopens this assessment. This
scoped release exception does not treat their vulnerable package versions
as patched.

Satori is reachable through Vinext's `next/og` shim and its SVG escaping
advisory remains a separate residual risk. The poster route accepts only
registered application-owned JPEGs and fixed style properties, renders
moderated title/byline text as text children, and returns PNG, never SVG.
These constraints must remain in place. Framework, validation-library and
build-tool upgrades need a separately validated change; do not apply the
audit's suggested downgrade of `eslint-config-next` or a broad framework
upgrade as part of replacing assets.

### 2026-10-18 dependency audit

Next and its lint config were updated to 16.3.8, Cloudflare Vite to 1.64.0,
Wrangler to 4.151.0, and transitive source-map-js to 1.2.2 before the v44
release. `npm audit --omit=dev` reports zero vulnerabilities. Full `npm audit`
still reports eight high findings from one unpatched `braces@3.0.3`
stack-exhaustion advisory, propagated through fast-glob/micromatch and the
lint/Vinext build tools. These parse repository/build patterns, not reader
input, and are not production runtime dependencies. This release records that
narrow build-tool exception; the audit is not described as clean. Do not apply
the suggested incompatible downgrades to eslint-config-next 14 or Vinext
0.0.15. Re-check for a patched braces version before the next release.


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
