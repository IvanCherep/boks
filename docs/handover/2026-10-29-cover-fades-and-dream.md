# Cover fades and Poe restoration — 29 October 2026

The user reported a visible horizontal shade on «Первый снег» and Binsey
Poplars, and asked to restore A Dream Within a Dream to its opening Series
frame. The latter had been replaced during the earlier redesign.

## Changes

- Keep the adaptive opacity and full protection behind the actual text. The
  former short linear ramps are now longer, with smoothstep opacity samples
  that flatten their slope at each end: 80px above and 160–280px below. Short
  landscape screens use 48px above to keep the independent wordmark clear.
- Initial WebKit loading could leave the measured shade at zero until a
  resize. The heading now resamples after image decoding and font readiness,
  including subsequent font loads; fixed line-height boxes need not resize
  when their glyphs change. Deferred callbacks stop scheduling after unmount.
- The Poe cover now comes from `01-parting-kiss.webp`, the opening scene of
  `public/poetry/dream-within-dream/`. The registered 720×1280 WebP is generated
  from that original, with its matching JPEG for the share renderer. The
  Series shelf uses the scene's 42%/40% focal point; the reader retains its
  centre crop. Other Series and catalogue assets are unchanged.
- New share links use poster version `v44-5`, so the corrected artwork can
  replace previously cached messenger cards. Previous asset files remain
  available for clients already open.

## Validation

`npm run check`, `npm run build` and `npm run check:deploy-target` pass. No
schema or data changes. Chromium and WebKit each check six covers at 402×736,
320×568, 874×402 and 1440×900, plus white-image/resize protection. Screenshots
compare the former fade with the new one; heading geometry is unchanged.
The restored image is checked in the reader and Series shelf, and the Worker
poster is inspected at 720×900. Browser fixtures intercept identity and feed
requests and block production writes. Local evidence is in the ignored
`work/cover-fade-2026-10-29/` directory.
The reported bright covers must receive protection on their initial phone
load, without a resize; other crops can legitimately need none.

## Release

The artwork/fade change is commit `8817e0c`; the initial WebKit loading fix is
`837e410`. Both were pushed to main. The final Worker was deployed from
`837e410` with `--keep-vars`, version
`1929a6ba-27d8-4385-ac59-9b8b9f25155a`, https://tryboks.com.

Chromium and WebKit each passed all 24 production cover cases, initial bright
phone protection, white-image/resize protection and the restored Series shelf.
There were no runtime errors or production writes. Production WebP/JPEG bytes
match local sources; the versioned link names the new poster and its PNG is
720×900 with `private, no-store`. Public page/security-header checks and the
unauthenticated feed's 401 passed. Local preview was stopped. Physical
iPhone/Arc appearance remains the user's device check.
CI passed for the final application commit:
https://github.com/IvanCherep/boks/actions/runs/40935104181.
