# boks Architecture Review

## Current Assessment

The current MVP architecture is workable and understandable. It has clear product surfaces, a separated recommendation registry, explicit analytics helpers, and a reasonable documentation entrypoint for AI agents.

The main architecture risk is not the current file structure. The main risk is uncontrolled future growth: adding every new reader, admin, author, data, and recommendation idea into the same few files until the MVP becomes hard to rewrite.

## What Is Strong

- Route files are thin and easy to reason about.
- Product surfaces are separated into reader, author, and admin components.
- Browser-facing contracts are centralized in `components/boks/client-types.ts`.
- Recommendation strategies are centralized in `lib/boks/recommendations.ts`.
- D1 analytics SQL is centralized in `lib/boks/analytics.ts`.
- Supabase browser access is isolated in `components/boks/supabase-browser-data.ts`.
- Supabase has RLS validation through `npm run verify:supabase`.
- Product rules are explicit in `AGENTS.md` and `specs/`.
- `docs/ai-agent-guide.md` gives non-Codex agents a direct onboarding and ownership map.

## Current Risks

### Reader Feed Size

`components/boks/reader-feed.tsx` is the largest UI file. It currently owns story navigation, focus mode, event capture, likes, comments, sharing, keyboard control, and touch gestures.

This is acceptable for MVP speed, but future work should extract only when the next feature creates repeated edits in the same area.

Preferred future split:

- `components/boks/reader/reader-feed.tsx`: orchestration.
- `components/boks/reader/story-viewport.tsx`: story layout and reading area.
- `components/boks/reader/reaction-rail.tsx`: like, comment, share controls.
- `components/boks/reader/comment-sheet.tsx`: comment capture.
- `components/boks/reader/use-reader-session.ts`: active story, timers, scroll progress, swipe outcomes.

### API Route Size

`app/api/boks/route.ts` still owns multiple D1 compatibility responsibilities: seeding, reader feed, comments, admin metrics, events, publishing, and export.

This is manageable while D1 is a compatibility path. If D1 remains active, split it.

Preferred future split:

- `lib/boks/d1/story-repository.ts`
- `lib/boks/d1/event-repository.ts`
- `lib/boks/d1/comment-repository.ts`
- `lib/boks/d1/admin-repository.ts`
- `app/api/boks/route.ts` as request orchestration only

### Supabase And D1 Split

The production reader, account, author moderation, comments, and admin MVP is Supabase-first. D1 remains as a compatibility path for the original API prototype, local/demo fallback, and richer attributed event contract reference.

This split is intentional for MVP continuity, but it must not become permanent by accident. New production behavior should usually go to Supabase first unless the user explicitly asks for local-only/demo work.

Migration direction:

1. Add attributed Supabase event tables.
2. Add Supabase recommendation assignment tables.
3. Move serious recommendation comparison from D1-shaped events to Supabase events and rollups.
4. Keep D1 only as a local/demo fallback or remove it.

### Metrics Maturity

The app has enough metrics for early testing, but serious recommendation comparison needs attributed Supabase events and rollups.

Next production metrics model:

- `recommendation_assignments`
- `reader_events`
- `story_metric_rollups_daily`
- `algorithm_metric_rollups_daily`
- `cohort_exports`

Do not build expensive metrics until the first real testing cohort confirms which questions matter.

## Recommended Directory Evolution

Current structure can stay for now:

```text
app/
components/boks/
lib/boks/
supabase/
docs/
specs/
```

When the product grows, move toward:

```text
components/boks/
  reader/
  author/
  admin/
  shared/
lib/boks/
  domain/
  recommendations/
  analytics/
  supabase/
  d1/
  validation/
specs/
docs/
```

Do this gradually. Do not perform a large directory rewrite while core product behavior is still changing weekly.

## Extension Points

### Add A Recommendation Algorithm

Owned by:

- `lib/boks/contracts.ts`
- `lib/boks/recommendations.ts`
- `specs/boks-recommendation-experiments.md`
- `components/boks/admin-dashboard.tsx` if displayed metrics change

### Add A Reader Event

Owned by:

- `components/boks/reader-feed.tsx` or a future `use-reader-session.ts`
- `components/boks/reader-behavior.ts` if inference changes
- `app/api/boks/route.ts` for D1 compatibility capture
- Supabase migration if production capture is needed
- `docs/testing.md` if operators should inspect it

### Add Or Change Comment Identity

Owned by:

- `components/boks/user-auth-panel.tsx`
- `components/boks/reader-feed.tsx`
- `components/boks/supabase-browser-data.ts`
- Supabase profile/comment RPC migrations
- `scripts/verify-supabase-mvp.mjs`
- `specs/boks-product-spec.md`

### Add A Story Operation

Owned by:

- `components/boks/admin-dashboard.tsx`
- Supabase RPC migration or D1 admin repository
- `docs/boks-operations.md`

### Add Bulk Import

Owned by:

- `scripts/`
- Supabase migrations
- Admin import UI or a CLI-first operator workflow
- Validation rules in `lib/boks/validation/` when that folder exists

## Refactor Rules

- Refactor only around active change pressure.
- Do not rename files without updating `AGENTS.md`, docs, and imports.
- Keep route files thin.
- Keep reader choice out of `/`.
- Keep admin scale controls server-side.
- Keep service role keys out of browser code.
- Preserve deterministic recommendation assignment until real accounts exist.

## Architecture Decision Records

For decisions that affect future rewrites, add a small ADR under `docs/decisions/`. The first ADR records why the MVP keeps its current surface-based structure.

ADR template:

```md
# ADR YYYY-MM-DD: Title

## Context

What changed or what pressure appeared?

## Decision

What are we doing?

## Consequences

What becomes easier, harder, or explicitly deferred?
```

Use ADRs for:

- moving author publishing from D1 to Supabase
- changing recommendation assignment
- adding authentication and roles
- adding custom domain hosting
- introducing rollup tables or background jobs
