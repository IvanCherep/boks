# ADR 2026-09-10: Keep MVP Architecture Surface-Based

## Context

boks is still in MVP validation. The product is expected to change repeatedly while testing whether readers want a swipe-first short literature feed and whether recommendation experiments can be compared from behavioral metrics.

The codebase already has three clear product surfaces:

- reader feed
- author cabinet
- admin console

The largest files are the reader feed and D1 compatibility API route, but they are still understandable and map directly to the current product surface.

## Decision

Keep the current surface-based structure for now:

- `components/boks/reader-feed.tsx`
- `components/boks/author-console.tsx`
- `components/boks/admin-dashboard.tsx`
- `lib/boks/recommendations.ts` (superseded 2026-09-12 by the `lib/boks/recommendations/` module; see `2026-09-12-typescript-ranking-and-attributed-events.md`)
- `lib/boks/analytics.ts`
- `app/api/boks/route.ts`

Do not perform a large directory rewrite until there is repeated change pressure in one surface.

Use `docs/architecture-review.md` as the refactor roadmap. Extract modules gradually when a file starts mixing responsibilities that change independently.

## Consequences

This keeps MVP iteration fast and makes it easy for AI agents to find the current behavior.

The tradeoff is that `reader-feed.tsx` and `app/api/boks/route.ts` remain larger than ideal. That is acceptable while the product is still moving. The next major refactor should split by domain responsibility, not by generic technical layers.
