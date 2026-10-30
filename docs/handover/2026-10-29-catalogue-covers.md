# Catalogue covers — 29 October 2026

The user supplied boks-illustrations-223-webp.zip and asked to use its covers
for the published catalogue while keeping every existing Series cover. They
also explicitly requested pushing all changes and deploying production.

## Result

- The archive maps all 223 published bok IDs correctly, with matching text
  checksums and 223 distinct WebP files. All images decode at 720×1280.
- The 32 Series boks were skipped. Their registry, WebP files and poster JPEGs
  were hashed before the import and remained identical: 65 preserved files.
- The other 191 WebP files are copied byte-for-byte to `public/covers/`, named
  by bok ID. No source PNG or regeneration was needed. Matching JPEGs in
  `public/share/art/` are 720×1280, made with Sharp JPEG quality 88 and mozjpeg
  for the renderer that cannot read WebP.
- `lib/boks/catalogue-artwork.ts` holds only crop/contrast metadata. The shared
  resolver in `components/boks/reader/bok-artwork.ts` gives Series precedence,
  retains its existing centred reader crop, rejects unregistered IDs and
  preserves typography for future boks. Ordinary illustrations never add a
  reading format or Series membership.
- The reader, bok menu, next preview, activity and browser/Worker share
  posters use the catalogue crop. Contrast comes from the manifest, with one
  visual correction: «Змея» needs a light wordmark over its dark tree canopy.
- Messenger links use `v44-4`; the Worker still checks publication before its
  private/no-store response and five-minute internal render cache.

## Source and schema alignment

The initial checkout was at `923bbe9`; production and origin/main were newer.
Fetched main through `e9f306d` and rebased the cover changes, preserving the
curated catalogue, summaries, current language rules, studies and fragment
cutter. The final app commits are `f94953e` and `0e0d122`, pushed to main.

The pending upstream migration
`20261029100000_boks_study_b2_music.sql` was required by that current source.
Before applying it, checked Б2 on production: disabled, empty materials,
zero participants and zero responses. The linked dry-run listed only that
migration; it was then applied. No schema change was introduced for covers.

## Validation

- `npm run check`: lint and typecheck pass; 1,363 unit tests pass, 15 skipped.
  The existing image-element/navigation lint warnings remain warnings.
- `npm run verify:schema`: 64 migrations and 451 assertions pass on a
  throwaway Postgres. OrbStack was started because its Docker daemon was off.
- `npm run build` and `npm run check:deploy-target` pass against the production
  Supabase origin.
- `npm run verify:supabase` and `npm run verify:divergence` pass.
- Chromium and WebKit at 390×844 and 1440×900: new light/dark covers and two
  existing Series covers, exact image paths and crops, no horizontal overflow,
  menu and activity thumbnails, share preview and real downloaded 1080×1350
  PNGs. Browser QA uses intercepted identity/feed data and blocks writes;
  it does not exercise ranking or create production reading events. Local
  WebKit preview removes only the HTTPS-upgrade directive from its HTTP test
  response; production keeps its actual security headers.
- After deployment, all 191 new WebP files and 32 Series WebP files return 200
  with hashes matching the preserved sources. Four real Worker posters
  (three new, one Series) return 720×900 PNG, private/no-store. An unknown bok
  returns 404. The messenger metadata points to `v44-4`.
- Reader, Series, admin, author, study, privacy and terms routes return 200
  with security headers. Both unauthenticated feed and fragment-model POSTs
  return 401; workers.dev redirects 308 to the canonical domain.
- The same Chromium/WebKit cover, menu, activity and PNG-download checks pass
  against the deployed production bundle at both viewport sizes, with no
  runtime errors. External Cloudflare telemetry remains blocked by the test.
- GitHub CI for app commit `0e0d122` passed both check and schema jobs:
  https://github.com/IvanCherep/boks/actions/runs/40923453438.

## Deployment

Deployed current source from main commit `0e0d122` using `npm run deploy`,
`--keep-vars` and the existing production Cloudflare account. Worker version:
`bad34ac9-3642-415e-b15b-31791abb5016`, at https://tryboks.com.

Screenshots, import hashes, browser fixtures and command logs remain in the
local ignored work directory. Browser checks are desktop emulation, not a
physical iPhone test.
