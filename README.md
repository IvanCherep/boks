# boks prototype

boks is a browser prototype for testing a short literature feed: readers discover stories that fit inside 15 minutes, authors publish from a simple cabinet, and the founder reviews engagement metrics.

## What is included

- Swipe-first reader feed with behavior-based recommendations.
- Like, share, completion, and comment capture.
- Author cabinet with a 15 minute reading-time guardrail.
- `/admin` business console with funnel, genre/mood breakdowns, sortable content operations, and JSON export.
- D1-backed shared storage for real test sessions.

## Main files

- `AGENTS.md`: product philosophy, architecture routing, growth guardrails, and validation checklist for AI coding assistants.
- `app/boks-client.tsx`: route compatibility exports for reader, author, and admin.
- `components/boks/reader-feed.tsx`: reader experience.
- `components/boks/author-console.tsx`: author cabinet.
- `components/boks/admin-dashboard.tsx`: admin/business console.
- `components/boks/`: browser-facing product helpers, types, behavior inference, data access, and shared UI primitives.
- `app/api/boks/route.ts`: API orchestration for reader, author, admin, events, and exports.
- `lib/boks/`: recommendation algorithms, analytics SQL, request helpers, contracts, and seed stories.
- `db/schema.ts`: D1 schema.
- `docs/architecture.md`: system map and data flows.
- `docs/boks-operations.md`: testing and operating guide.
- `docs/growth-readiness.md`: scale posture and next growth work.
- `specs/boks-product-spec.md`: product scope and extension points.
