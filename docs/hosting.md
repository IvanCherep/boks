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
- production redirect URL `https://tryboks.com`, with the workers.dev origin
  kept on the allow-list while live links still name it;
- manual anonymous-user linking when preserving guest history during sign-up is required.

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
- The current sender is `onboarding@resend.dev`, which is Resend's sandbox
  sender. It has been verified against `ivanystal@gmail.com`.
- This sandbox sender only delivers to the Resend account owner's exact email.
  Before inviting outside testers, verify a real sending domain in Resend and
  change `[auth.email.smtp].admin_email` to an address on that domain, for
  example `login@tryboks.com`.
- Keep the Resend API key out of source. Push it with
  `RESEND_API_KEY=<secret> npx supabase config push --project-ref <project-ref>`.

Use `supabase config diff` before pushing config. Do not run a full config push if it would overwrite unrelated remote settings such as SMS/provider configuration.

## Deploy

Before deploy:

```bash
git status --short
npm run lint
npm run verify:supabase
npm run build
node /Users/iegorov/.codex/plugins/cache/openai-bundled/sites/0.1.66/scripts/build-site.mjs
```

Deploy:

```bash
npm run deploy
```

The deploy command builds the app and runs:

```bash
wrangler deploy --config wrangler.jsonc --keep-vars
```

`--keep-vars` matters because Cloudflare dashboard variables must not be deleted by a deploy that only includes source config.

## Verify Production

Run:

```bash
curl -I https://tryboks.com/
curl -I https://tryboks.com/admin
curl 'https://tryboks.com/api/boks?view=reader&limit=20&visitorId=agent-check'
curl 'https://tryboks.com/api/boks?view=admin&limit=20'
```

Expected:

- `/` returns `200`.
- `/admin` returns `200`.
- Reader API returns a bounded story payload.
- Admin API returns `403`; admin metrics load inside `/admin` through Supabase role-checked RPCs.

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
- Custom domains: none, unless a real domain is added later.
- Routes: none, unless a real domain route is added later.

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

Prefer rollback by redeploying a known good commit or Cloudflare Worker version.

Do not change the account `workers.dev` subdomain again unless the URL strategy changes. It affects every Worker under the account.

If `tryboks.com` fails after a deploy:

1. Check `wrangler deployments list --config wrangler.jsonc`.
2. Check `Workers & Pages -> read -> Deployments`.
3. Check `Workers & Pages -> read -> Domains`.
4. Re-run `npm run deploy` from the last known good source.
5. If needed, rollback the active Worker version in Cloudflare dashboard.
