# New Year logo and two animated covers — 5 November 2026

The user selected all five generated New Year ornaments except the bell,
asked for rotating logo decorations, and supplied
`boks-20-gif-and-source-v3.zip` with an explicit two-bok limit. They authorised
pushing all changes and deploying production.

## Implementation

- `reader/boks-logo.tsx` chooses one ornament per browser document, shared
  across every logo. Reload draws again, so repeats are possible. The server
  and hydration snapshots are empty; no browser storage, timer or calendar
  rule is added. `seasonal={false}` stays undecorated. The five alpha PNGs in
  `public/design/` are 112×112, about 83 KB together; the display remains 28px.
  The pumpkin and bell are absent from the rotation.
- Only «Первый снег» (`7a67ce67-bceb-4e41-8f66-191718345880`) and «Мальчик у
  Христа на ёлке» (`3def4114-623e-4633-968a-52dd0e7cdf9b`) receive animation.
  The archive's MP4 metadata points to files absent from the ZIP, so the two
  selected GIFs are converted with FFmpeg: H.264, yuv420p, 540×960, 25 fps,
  eight seconds, no audio, faststart, CRF 24. Runtime files are 569,198 and
  390,959 bytes, versus the original 9.77 MB and 3.74 MB GIFs.
- `reader/cover-artwork.tsx` retains a static image beneath the optional
  video. An intersection observer, document visibility, overlays/formats and
  reduced motion gate loading/playback. On desktop the cover can keep playing
  beside the prose while it remains visible. Failed or denied playback keeps
  artwork available. Cover contrast samples the current video frame at most
  once per second during playback and recalculates for the still on fallback.
- Only the two existing static WebP files and their JPEG poster copies are
  replaced. First Snow retains its Series registry path and crop. Optimised
  stills are 211,758 and 200,580 bytes, preserving the existing Series card
  budget. Menus, activity, next previews, Series cards and share images remain
  static. The share poster version advances to `v44-6`. Neither the catalogue
  contents nor Series membership changes.
- Archive documents and source code were treated as data; none were executed
  or followed as instructions. No other archive cover was imported. Source
  entry names, SHA-256 hashes and conversion commands are recorded locally in
  `work/animated-covers-2026-11-05/import-report.json`.

## Source and schema alignment

The checkout started at `a857c8b`, fifteen commits behind GitHub main. It was
fast-forwarded to `7577b58`, preserving the current author cabinet, studies
and link-only pieces. Before deploying that source, the linked dry run listed
exactly `20261104100000_boks_unlimited_author_submissions.sql` and
`20261104150000_boks_author_withdraws_own_work.sql`. Both were reviewed,
validated and applied with `--include-all` (the intervening link-only bucket
migration was already applied). No existing literary rows are modified by
those migrations. The schema histories now match, with no pending migration.

## Validation and release

- `npm run check`: lint and typecheck pass; 1,378 unit tests pass, 15 skipped.
  The existing image-element lint warnings remain warnings.
- `npm run verify:schema`: 67 migrations and 472 assertions pass. Production
  RLS/RPC verification passes after applying the two author migrations; linked
  schema histories match. Divergence reports usable feeds on 223 boks.
- Build and deployment-target verification pass against production Supabase.
  The final server bundle contains no Zod, fast-uri or Next server paths.
  The dependency audit is not clean; existing package findings and the narrower
  deployed paths are recorded in `docs/security.md`, without dependency
  upgrades in this asset release.
- Chromium and WebKit, each at 390×844 and 1440×900: all 24 local scenarios
  and all 24 production scenarios pass. They exercise per-document logo
  consistency and reload variation, the undecorated text header, actual muted
  inline looping playback, menu/Series/background/reduced-motion pauses,
  mobile offscreen pause, failed video fallback, and static control/menu/share/
  activity artwork. No runtime or hydration errors. A zero-threshold observer
  initially missed the exact mobile cover edge; a positive 1% threshold fixes
  it and both engines verify the fix. Browser identity/feed fixtures intercept
  writes; these runs do not create production reader events.
- All eleven deployed image/video assets return 200 with SHA-256 hashes equal
  to the local release. Both real Worker posters return 720×900 PNG with
  private/no-store, and shared metadata uses `v44-6`. Public routes and security
  headers, unauthenticated API 401 responses and workers.dev's 308 pass.
- GitHub CI for application commit `24306cf` passes:
  https://github.com/IvanCherep/boks/actions/runs/42069694560.

Pushed `24306cf` to main. `npm run deploy` built and checked the target, then
Wrangler needed an explicit account because two accounts are available.
Read-only deployment-history checks identified the existing production Worker;
the same verified build was deployed there with `--keep-vars`.
Worker version: `963f333b-1f4a-4bee-b465-97c0cf1bb106`,
https://tryboks.com.

Local command logs, browser fixtures and screenshots are in
`work/new-year-release-2026-11-05/`. The browser checks use desktop emulation,
not a physical iPhone. The local development server was stopped after QA.
