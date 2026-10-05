# 0010: One origin - the apex `tryboks.com`

Date: 2026-09-22
Status: accepted

boks is served from `https://tryboks.com` only. A browser origin is a separate storage bucket, so a second origin means a reader signed in on one looks signed out on the other - which happened with `read.tryboks.workers.dev`, where sign-in links returned readers to the old host. That host now 308-redirects every page to the apex (`lib/boks/canonical-host.ts`, applied in `proxy.ts`), leaving `/api/` and `/_next/` alone for tabs already open there. `www` is not attached as a custom domain; it belongs behind a zone-level redirect. `"workers_dev": true` stays explicit in `wrangler.jsonc`, because omitting it turned the old host into a 404.
