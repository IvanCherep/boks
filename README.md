# boks prototype

boks is a browser prototype for testing a short literature feed: readers discover stories that fit inside 15 minutes, authors publish from a simple cabinet, and the founder reviews engagement metrics.

## What is included

- Reader feed with mood and time-based recommendations.
- Like, share, completion, and comment capture.
- Author cabinet with a 15 minute reading-time guardrail.
- Metrics dashboard and JSON export.
- D1-backed shared storage for real test sessions.

## Main files

- `app/boks-client.tsx`: product interface.
- `app/api/boks/route.ts`: API, seed stories, metrics aggregation.
- `db/schema.ts`: D1 schema.
- `docs/boks-operations.md`: testing and operating guide.
- `specs/boks-product-spec.md`: product scope and extension points.
