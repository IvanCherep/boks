# boks Engineering Standards

## Product Values

boks values focused reading, behavioral learning, and fast iteration.

Reader values:

- One algorithmic feed, not a catalog.
- Minimal interface during reading.
- No manual finished button.
- Short stories or fragments that fit a 15 minute break.
- Readers should not need onboarding to begin.
- Reader accounts are optional until the guest limit is reached.

Business values:

- Decisions come from behavior and interviews together.
- Metrics must be attributable to content, recommendation strategy, and cohort.
- Admin tooling can be dense; reader tooling must be quiet.
- Admin access must be granted from the admin panel and enforced in the database.
- The MVP must remain cheap to change.

Engineering values:

- Keep names literal and domain-specific.
- Keep modules separated by product surface and responsibility.
- Prefer boring code over clever abstractions.
- Add extension points only when they remove current friction.
- Update specs and docs with behavior changes.
- Optimize the repository for agent comprehension: obvious filenames, explicit contracts, focused docs, and small ownership boundaries.

## Naming Standards

The domain vocabulary is `CONTEXT.md`: use its terms in new identifiers, tests, issues and commit messages, and never a synonym it lists under _Avoid_. Its "Legacy names in code" table lists the names that predate it (`reels`, `Story`, `storyId`); keep them where they already are and use the glossary term in new code.

Avoid generic names when a domain name is clearer:

- Prefer `readerProfile` over `profile`.
- Prefer `storyMetrics` over `data`.
- Prefer `recommendationExperiment` over `variant`.
- Prefer `recordReaderEvent` over `track`.

## Module Boundaries

Route entrypoints stay thin:

- `app/page.tsx`
- `app/author/page.tsx`
- `app/admin/page.tsx`

Reader UI starts in:

- `components/boks/reader-feed.tsx`
- `components/boks/reader-behavior.ts`
- `components/boks/user-auth-panel.tsx`
- `app/globals.css`

Author UI starts in:

- `components/boks/author-console.tsx`

Admin UI starts in:

- `components/boks/admin-dashboard.tsx`

Client data access starts in:

- `components/boks/use-boks-data.ts`
- `components/boks/supabase-browser-data.ts`

Recommendation logic starts in:

- `lib/boks/recommendations/strategies/index.ts` to add an algorithm
- `lib/boks/recommendations/feed.ts` for ranking rules that apply to every algorithm
- `lib/boks/recommendations/metrics.ts` for what a metric means
- `lib/boks/recommendations/experiments.ts` for assignment and traffic split

Feed serving starts in:

- `app/api/feed/route.ts`
- `lib/boks/feed-service.ts`

Supabase schema starts in:

- `supabase/migrations/`
- `scripts/verify-supabase-mvp.mjs`

## Coupling Rules

- Reader components may use browser-safe Supabase helpers.
- Reader components must not import server-only helpers.
- Server API code may import `lib/boks/*`.
- `lib/boks/contracts.ts` imports nothing, so it is safe from browser, worker and test code.
- `lib/boks/recommendations/` runs in both the Worker (`/api/feed`, the canonical path) and the browser (the labelled fallback). Never add a server-only or browser-only import to it.
- `lib/boks/recommendations/` owns the algorithm registry, ranking and metric definitions. SQL returns counters; it never decides an order or a rate.
- `lib/recsys/aggregate/metrics.ts` owns metric definitions; nothing else redefines a rate.
- Supabase aggregate SQL belongs in Supabase migrations until extracted into a managed SQL source folder.
- Supabase user role checks belong in RLS policies or security-definer RPCs. Browser components may display role state but must not enforce it alone.
- Shared UI components in `components/boks/shared-ui.tsx` should stay small and product-neutral.

## Spec-Driven Development

Before implementation:

1. Read the relevant spec.
2. Write down which product rule changes, if any.
3. Decide which module owns the change.
4. Keep the first implementation small.
5. Add tests or verification for the changed behavior.
6. Update docs in the same task.

For AI agents, `AGENTS.md` is the entry point. Treat specs as source of product truth and docs as the operating map. Code that changes product behavior without updating specs/docs is incomplete.

If a change adds a recommendation algorithm, update:

- `lib/boks/recommendations/strategies/<name>.ts`
- `lib/boks/recommendations/strategies/index.ts`
- `lib/boks/recommendations/feed.test.ts`

If a change affects the recommendation contract or a metric, also update:

- `lib/boks/contracts.ts`
- `lib/boks/recommendations/metrics.ts`
- The Supabase event/lab migration
- `specs/boks-recommendation-experiments.md`
- `components/boks/admin/recommendation-lab.tsx`

If a change affects production data, update:

- `supabase/migrations/`
- `scripts/verify-supabase-mvp.mjs`
- `docs/testing.md`
- `docs/growth-readiness.md` if scale assumptions change

If a change affects public reader identity or comments, update:

- `components/boks/user-auth-panel.tsx`
- `components/boks/reader-feed.tsx`
- `components/boks/supabase-browser-data.ts`
- Supabase profile/comment migrations
- `specs/boks-product-spec.md`

## UI Standards

Reader surface:

- Light, readable palette.
- Story text owns the screen.
- Controls can be visible on story change, tap, hover, or pause.
- Controls should fade during active reading.
- Literature typography uses the bundled Source Serif 4 variable font. Keep the font local, preserve Latin and Cyrillic coverage, and keep its SIL OFL text reachable from Settings.
- Horizontal navigation follows the product mapping: left is previous, right is next. Vertical navigation changes boks only from a text boundary. Keep the pure rules and tests in `components/boks/reader-navigation.ts`.
- Avoid cards inside cards.
- Avoid decorative backgrounds that reduce readability.
- Test small phone and desktop.

Admin surface:

- Dense but readable.
- Use tables, filters, search, sorting, pagination, and exports.
- Do not load the full catalog into the browser.
- Use explicit metric labels and comparable units.

Author surface:

- Keep publishing simple.
- Enforce the 15 minute promise before publication.
- Do not add heavy author analytics until reader testing proves demand.

## Data Standards

High-volume behavior should be typed and indexed when it drives queries:

- event type
- story id
- visitor or user id
- algorithm id
- segment
- surface
- rank
- elapsed seconds
- created time

Low-volume exploratory fields may live in JSON metadata.

Do not use browser storage for production metrics. Browser storage is only for:

- anonymous local browser id
- Supabase session persistence
- lightweight reader preference state

Do not store or trust admin roles in browser storage, URL params, `user_metadata`, or any user-editable field. Admin role state lives in `public.user_profiles.role` and must be enforced through RLS or explicit RPC checks.

## AI Agent Workflow

Future AI agents should:

1. Read `AGENTS.md` and follow its read order.
2. Check `git status --short`.
3. Inspect the owning files before editing.
4. Make narrowly scoped changes.
5. Avoid unrelated refactors.
6. Run validation.
7. Update docs and specs when behavior changes.

When a file grows beyond comfortable review size, extract by responsibility, not by technical type alone. Example: split reader feed into reading state, story viewport, reaction rail, and comments only when those pieces start changing independently.

## Definition Of Done

A change is done when:

- The intended product behavior works.
- `npm run lint`, `npm run typecheck` and `npm test` pass, or failures are explained.
- Schema changes pass `npm run verify:schema`, and product-flow changes pass `npm run test:supabase` against a local stack.
- Public deploy checks pass for hosting changes.
- Specs/docs are current.
- The repo has no unrelated accidental changes.
- Future agents can find the new behavior by file name or documentation.
