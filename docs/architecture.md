# boks Architecture

The module map and the data flows. Terms are defined in `CONTEXT.md`; the decisions behind the shape are in `docs/adr/`.

## Shape

- **Hosting**: one Cloudflare Worker (`read`) with static assets, serving `https://tryboks.com` (`docs/hosting.md`). Built with vinext (Next.js App Router on Vite).
- **Data and auth**: Supabase - Postgres with RLS and narrowly scoped RPCs, anonymous sessions for guests, email OTP for accounts. It is the only store (`docs/adr/0013-remove-d1-compatibility-path.md`).
- **Ranking**: pure TypeScript in `lib/boks/recommendations/`, run by the Worker at `/api/feed`, which also records the served feed. The browser runs the same code only as a labelled fallback (`docs/adr/0001-ranking-executes-in-worker.md`).
- **Surfaces**: the reader (`/`, `/series`, `/b/<id>`, `/a/<handle>`), the author cabinet (`/author`) and the admin console (`/admin`).

## Module map

### Routes (`app/`)

- `app/page.tsx`, `app/series/page.tsx`, `app/author/page.tsx`, `app/admin/page.tsx`: route entrypoints only. `app/boks-client.tsx` re-exports the three client surfaces.
- `app/b/[id]/page.tsx`: a shared bok. Server-rendered so messengers get a title, description and cover (`lib/boks/share-preview.ts`); `open-shared-bok.tsx` then opens it in the reader.
- `app/b/[id]/image/route.tsx` + `lib/boks/share-poster.tsx`: portrait PNG for a shared published bok, with the same artwork/palette, title and byline as Share bok. The Worker checks publication before its five-minute image cache, loads only owned static assets and uses `next/og`. Fonts and JPEG conversions of the registered Series covers live in `public/share/`; new share links carry the poster version from `lib/boks/share-link.ts`.
- `app/a/[handle]/page.tsx`: an author's public page.
- `app/api/feed/route.ts`: the canonical feed. Forwards the reader's Supabase JWT (the Worker holds no elevated credential), assigns the arm, ranks, records the served feed.
- `app/api/geo/route.ts`: the two-letter country from Cloudflare's `CF-IPCountry`; the IP is never read.
- `app/privacy/page.tsx`, `app/terms/page.tsx`: legal pages.
- `app/layout.tsx`, `app/globals.css`: document shell, theme bootstrap and base styles. `app/reader-v44.css`, `app/formats-v44.css`, `app/social-v44.css`, `app/admin-v44.css` scope the accepted v44 tokens and surfaces to reader and Studio, preserving the author cabinet.
- `proxy.ts`: security headers (`lib/boks/security-headers.ts`) and the canonical-host redirect (`lib/boks/canonical-host.ts`).

### Reader (`components/boks/`)

- `reader-feed.tsx`: the swipe-first reader - navigation, reading outcomes, reactions, guest gates, formats.
- `reader-navigation.ts`: pure direction, edge-tap and text-boundary rules shared by touch, pointer, wheel and keyboard.
- `reader-behavior.ts`: visitor id, local reader profile, word-count-based read/skip inference, slate size.
- `reader-clock.ts`: the foreground-only reading clock. `reader/text-reading-state.ts` measures HTML-body bounds as cover / reading / finale; `reader-feed.tsx` holds the clock for covers, endings, overlays and inactive playback.
- `reader-events.ts`: the attributed reader-event queue - batching, retry, per-read dedupe, keepalive flush on exit.
- `reader-place.ts`, `reader-library.ts`, `reader-text.ts`, `reader-haptics.ts`, `reader-sheet.tsx`: held place, the Read/Liked/Commented library, text shaping, haptics, the sheet primitive.
- `comments-sheet.tsx` + `comment-threads.ts`: the lazy-loaded comment conversation with one-level replies and comment likes; pure root/reply ordering.
- `user-auth-panel.tsx`: sign-up and sign-in (link or code), settings, the account library, admin shortcut. `magic-link-cooldown.ts` paces resends.
- `author-sheet.tsx`: an author's boks inside the reader.
- `feedback.ts`, `feedback-form.tsx`: the no-account feedback box and its milestone prompts.
- `reading-languages.ts`: the server-saved reading languages. `reader-preferences.ts` + `reader-preference-controls.tsx`: independent device locale and typography preferences.
- `reader/boks-logo.tsx`, `reader/bok-artwork.ts`: shared wordmark and exact-ID series artwork resolution, with typography for ordinary boks. Seasonal decoration is an explicit option, not a guessed calendar.
- `share-card.tsx` + `share-card-export.ts`: bok-link sharing and real canvas poster export, with native/copy/download fallbacks.
- `theme.ts`, `theme-setting.tsx`: System/Light/Dark, applied before first paint.
- `reading-music.ts`, `reading-fullscreen.ts`, `home-screen-hint.ts`: ambient music, fullscreen for formats on Android/iPad, the one-time iPhone home-screen hint.
- `error-boundary.tsx`: the crash screen around every surface.

### Interface language

- `lib/i18n/ui-language.ts`: which interface language a device gets (Russian if its first language is Russian, else English, or the pinned choice) and the `<html lang>` boot script. `lib/i18n/messages.ts`: `defineMessages` tables and `plural`. `components/boks/ui-language.tsx`: `useMessages` / `useUiLanguage`, no provider. `lib/i18n/content-languages.ts`: names of the languages *texts* are in. See `docs/adr/0015-interface-language-follows-the-device.md`.

### Reading formats and the series shelf

- `components/boks/cinema/`: cinema - narration track, scenes, story moments, voices.
- `components/boks/poetry/`: immersive poems; manifests are built by `lib/boks/poetry/manifest.ts` from each poem's own recording.
- `components/boks/interactions/` + `lib/boks/interactions/`: the story-moment scenes and their sound.
- `components/boks/reading-finale.tsx`: the one ending HTML reading and both formats share; drafts/actions remain owned by the reader.
- `components/boks/cinema/format-controls.tsx`, `media-level.ts`: shared real-position transport, Sound and media gain.
- `components/boks/series/`: the series shelf - `series-catalogue.ts` (registry and published shelf projection, tested against both format registries), `series-view.tsx` (published shelf and Feed/Series/You tabs), `series-progress.ts` (heard marks in browser storage).
- How a piece is produced and added: `docs/reading-formats.md`.

### Author and admin

- `components/boks/author-console.tsx`: submission cabinet, review status, refusal reason, revision, the length guardrail. `lib/boks/author/submission-quota.ts` mirrors the daily limit for the UI; the database is the authority. `lib/boks/bok-title.ts` mirrors the title-from-first-line rule.
- `components/boks/admin-dashboard.tsx`: admin auth, grouped Studio navigation and per-section loading.
- `components/boks/admin/`: one file per tab - `overview.tsx`, `moderation-queue.tsx`, `rights-review.tsx`, `content-operations.tsx`, `people.tsx`, `guest-funnel.tsx`, `guest-day.tsx`, `tracked-links.tsx`, `growth.tsx`, `feedback-inbox.tsx`, `catalogue-import.tsx`, `recommendation-lab.tsx` (+ `experiment-editor.tsx`, `sample-size-panel.tsx`, `position-effects.tsx`, `metric-bars.tsx`), and the poetry/interaction sandboxes.
- `components/boks/admin/admin-inspector.tsx` + `inspector-context.tsx`: the console's one detail surface. Every tab opens a bok or a person with `useAdminInspector().openBok(id)` / `openPerson(userId)`; never build a per-tab detail view. Views: `bok-inspector.tsx`, `person-inspector.tsx`.
- `components/boks/admin/bok-lifecycle-dialog.tsx`: the only hide / restore / erase confirmation. Authority is the RPC's `is_boks_admin`, never this UI.

### Data access

- `components/boks/supabase-browser-data.ts`: every browser read and write, using only the publishable key, RLS and RPCs.
- `components/boks/use-boks-data.ts`: reader/admin loading and mutations.
- `components/boks/worker-feed-breaker.ts`: when `/api/feed` is slow or failing, the browser ranks for a cool-down period and labels those feeds degraded.
- `components/boks/client-types.ts`, `constants.ts`, `client-format.ts`: browser contracts, constants, formatting.
- `lib/boks/feed-service.ts`: `serveReaderFeed` - load config and candidates, resolve the stored assignment, rank, record the served feed. One implementation behind two transports: `lib/boks/supabase-rest.ts` (Worker) and the browser client.
- `lib/boks/supabase-reels.ts`: candidate rows to `StoryCandidate`.
- `lib/boks/supabase-client.ts`: the browser Supabase client, anonymous sessions, OTP sign-in.
- `lib/boks/journey.ts`: guest journey events (visit, sign-up prompt, link request).
- `lib/boks/browser-id.ts`, `network-errors.ts`, `errors.ts`, `magic-link-errors.ts`, `http-security.ts`, `geo.ts`, `contact.ts`: ids that never throw, telling a blocked network from a crash, error shaping, bounded JSON parsing, country codes, the support address.

### Recommendation and research

- `lib/boks/contracts.ts`: event types, the attributed `ReaderEvent`, the daily submission limit. Imports nothing.
- `lib/boks/recommendations/`: `signals.ts` (0..1 ranking signals), `strategy.ts` (the contract), `strategies/` (one file per algorithm; `strategies/index.ts` is the registry list), `registry.ts`, `experiments.ts` (split and deterministic assignment), `feed.ts` (`buildReaderFeed`, the one ranking seam), `reader-profile.ts`, `metrics.ts`, `divergence.ts`, `versions.ts` (version stamps on every served feed).
- `lib/recsys/aggregate/`: reader-level metric definitions and comparison inputs - the one catalogue of metrics. `lib/recsys/statistics/`: comparison, power and sample-size statistics.
- `lib/boks/import/`: catalogue file parsing and the wikitext converter.

### Database and tooling

- `supabase/migrations/`: the schema, RLS, grants and RPCs, applied in filename order. Never edit an applied one.
- `supabase/config.toml`: Auth config. `supabase/functions/embed/`: the embedding Edge Function, refused until a multilingual model is available (`docs/adr/0012-single-embedding-model.md`).
- `scripts/verify-schema-local.mjs` + `scripts/local-supabase/`: every migration plus behaviour and grant checks on a throwaway Postgres.
- `scripts/run-supabase-flow-test.mjs`: the full product flow against a local Supabase stack.
- `scripts/check-algorithm-divergence.mts`: do the arms produce different feeds.
- `scripts/check-deploy-target.mjs`: refuses a build that points at a local backend.
- `scripts/embed-catalogue.mjs`, `scripts/build-catalogue-sql.mjs`, and the corpus fetch/build scripts: catalogue production.

## Reader flow

1. `/` gets or creates the visitor id and an anonymous Supabase session (a guest), or restores the account's session.
2. The browser asks `/api/feed` for a slate, sending its JWT, its reading languages and a profile snapshot. The Worker loads the experiment config and candidates (`get_recommendation_candidates` - published boks in the reader's languages with behaviour counters and semantic similarity), resolves the reader's stored arm, ranks with `buildReaderFeed`, records `served_feed` + `served_feed_item`, and returns the slate with its `feedId`.
3. If `/api/feed` fails or is slow, `worker-feed-breaker.ts` lets the browser rank the same way for a cool-down; those feeds are recorded with `serving_backend = 'browser'`.
4. Every behaviour goes through `reader-events.ts` into `record_recommendation_events`, attributed with algorithm, experiment, segment, rank, feed id, foreground seconds and progress. The feed appends the next slate five boks before the end.
5. A direct Series visit does not expose the background feed: only a bok actually shown in the reader/player emits impression, heartbeat or outcome. Series continuation captures the current published shelf order and keeps `entry: "series"`.
6. Guest gates count distinct boks after actual foreground reading dwell on the device: notices at 5 and 10, sign-up at 15.

## Accounts and comments

1. Guests are anonymous Supabase sessions: they read boks and comments.
2. Likes, comments, follows and submissions need an account; the UI gates them and RLS/RPCs enforce it (anonymous sessions also hold the Postgres `authenticated` role, so RPCs check `is_anonymous`).
3. `user_profiles` holds the unique `handle`, the role, terms acceptance and settings. Handles change only through `update_boks_user_profile()`.
4. Comments are written by `create_bok_comment()`, which attributes them to the caller's handle.
5. A bok's byline (`reels.author_name`) is chosen when publishing and does not follow the account (`docs/adr/0005-handle-is-identity-byline-is-pen-name.md`).

## Author and moderation

1. `submit_bok_for_review()` writes a private `reels` row with `status = 'pending_review'`, enforcing the 15-minute promise and 3 submissions per UTC day under a lock on the author's profile row. `get_my_bok_quota()` reports the remainder.
2. Admins approve or refuse with `review_bok_submission()`; approval requires a confirmed rights record. Refusal stores a reason only the author and admins see.
3. `archive_bok()` hides a bok reversibly with actor, time and reason; `restore_archived_bok()` returns it to its previous status; `delete_archived_bok()` erases only an archived bok and requires its exact title.
4. No browser writes `reels.status`, roles or suspension directly; all of it is admin-checked RPCs.

## Recommendation flow

```text
candidates + reader history ──▶ deriveFeedSignals ──▶ algorithm.score / rerank
                                                          │
   experiment config ──▶ assignExperimentArm ─────────────▶ buildReaderFeed ──▶ slate + attribution
```

1. `get_active_recommendation_experiment()` returns the live split; the assignment is deterministic per reader and stored once in `recommendation_assignments`.
2. `deriveFeedSignals` normalises each candidate into 0..1 signals, reading the reader's server-side history (`bokState`) for fatigue and novelty.
3. The assigned algorithm scores or reranks. Reading fatigue is applied in `feed.ts` for every algorithm that does not handle it itself.
4. `get_recommendation_lab()` returns raw counters; rates, uplift and readiness are derived in TypeScript from the definitions in `lib/recsys/aggregate/metrics.ts`.

Adding an algorithm: one file in `lib/boks/recommendations/strategies/`, one line in its `index.ts`, one ranking case in `feed.test.ts`, then give it traffic in `/admin`. The id union, the lab, the split editor and attribution all derive from the registry.

## Scaling principles

- Reader and admin views request bounded pages or batches.
- SQL returns counters; rates are derived once, in TypeScript.
- Exploratory signals live in event `metadata`; a signal queried often becomes a typed, indexed column.
- `get_recommendation_candidates` and `get_recommendation_lab` aggregate the raw event stream and are the first queries that will need rollup tables. Both are bounded today (60 days of events, 400 newest published boks).
- Browser code uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; authority is RLS and RPC checks, never browser state.
