# boks Hosting Guide

## Current Hosting Shape

boks is hosted on Cloudflare Workers with Static Assets.

Current public URL:

`https://read.tryboks.workers.dev`

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
- production redirect URL `https://read.tryboks.workers.dev`;
- manual anonymous-user linking when preserving guest history during sign-up is required.

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
curl -I https://read.tryboks.workers.dev/
curl -I https://read.tryboks.workers.dev/admin
curl 'https://read.tryboks.workers.dev/api/boks?view=reader&limit=20&visitorId=agent-check'
curl 'https://read.tryboks.workers.dev/api/boks?view=admin&limit=20'
```

Expected:

- `/` returns `200`.
- `/admin` returns `200`.
- Reader API returns a bounded story payload.
- Admin API returns `403`; admin metrics load inside `/admin` through Supabase role-checked RPCs.

Then open these routes in a browser:

- `https://read.tryboks.workers.dev/`
- `https://read.tryboks.workers.dev/admin`
- `https://read.tryboks.workers.dev/author`

Check browser console for runtime errors.

## Cloudflare Dashboard Checks

In Cloudflare dashboard, open:

`Workers & Pages -> read -> Domains`

Expected:

- Production Worker URL: enabled.
- Production URL: `read.tryboks.workers.dev`.
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
dig @1.1.1.1 +short read.tryboks.workers.dev A
dig @8.8.8.8 +short read.tryboks.workers.dev A
```

If Cloudflare dashboard shows the Worker URL enabled and public DNS eventually resolves, wait before changing config again.

## Rollback

Prefer rollback by redeploying a known good commit or Cloudflare Worker version.

Do not change the account `workers.dev` subdomain again unless the URL strategy changes. It affects every Worker under the account.

If `read.tryboks.workers.dev` fails after a deploy:

1. Check `wrangler deployments list --config wrangler.jsonc`.
2. Check `Workers & Pages -> read -> Deployments`.
3. Check `Workers & Pages -> read -> Domains`.
4. Re-run `npm run deploy` from the last known good source.
5. If needed, rollback the active Worker version in Cloudflare dashboard.
