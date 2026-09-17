# ADR-001: Where ranking executes, and who writes provenance

Date: 2026-09-13
Status: accepted
Phase: 1 (measurement correctness)

## Context

Ranking currently runs in the browser. `components/boks/supabase-browser-data.ts`
fetches candidates from Supabase, calls `buildReaderFeed`, and renders the
result. Nothing persists what was served: only the resulting events are stored,
carrying `algorithm_id` and `rank`.

Three consequences make this untenable for a research platform:

1. **A served feed cannot be reconstructed.** The candidate set, the reader
   profile and the config are all mutable. Two of them live only in the browser.
   "We think it would have ranked this way" is not a reproducible claim.
2. **Attribution is a client assertion.** The server records whatever
   `algorithm_id` the browser reports. A bug in the client is indistinguishable
   from reality.
3. **A silent second path exists.** When the Supabase path throws,
   `use-boks-data.ts` falls back to the legacy `/api/boks` (D1) endpoint. Those
   readers' events land in a different store under a locally recomputed arm, and
   never appear in data-quality reporting.

The thesis requires that every served recommendation be attributable to a
reproducible model and config (Definition of Done #1).

## Options considered

**(a) Keep browser ranking, persist nothing more.** Status quo. Rejected: fails
DoD #1 outright.

**(b) Keep browser ranking, have the client POST the served slate.** Cheapest.
Provenance exists, latency unchanged. But provenance remains a client claim, and
the failure mode we most need to catch — a client bug — is exactly the one this
cannot detect.

**(c) Keep browser ranking, client POSTs the slate, server recomputes it from
recorded inputs and flags mismatches.** Detects client bugs. But if the server
can recompute the ranking, it can serve it; the verification machinery is pure
cost, and it requires pinning the candidate set anyway.

**(d) Move canonical feed assembly to the Worker.** The Worker fetches
candidates, ranks, persists `served_feed` + `served_feed_item`, and returns the
slate. Ranking functions stay pure and shared, unchanged.

## Decision

**(d).** The Worker becomes the canonical feed server, at a new `/api/feed`
route. The ranking functions in `lib/boks/recommendations/` are not modified:
only the call site moves.

Specifically:

- `buildReaderFeed` and everything under it stay pure, shared and offline-testable
- the Worker forwards the reader's Supabase JWT, so RLS still applies and the
  Worker holds no elevated credentials
- the Worker writes provenance before returning the slate
- the browser keeps a ranking path, but it is now a **labelled degraded mode**
  (`serving_backend = 'browser'`), not a silent twin
- the D1 path is likewise labelled (`serving_backend = 'd1_fallback'`) and its
  events are ingested into the canonical store rather than diverted

## Consequences

Easier:

- every served feed is reconstructible from `served_feed` + `served_feed_item`
- attribution is written by the party that did the ranking
- the invisible split (V4) becomes a labelled, countable condition
- interleaving becomes implementable: a slate drafted from two rankers needs
  per-slot provenance, which only the server can honestly record
- the reader profile used at serve time is captured in `profile_snapshot`, so a
  ranking can be replayed even after the profile changes

Harder or paid for:

- **one extra network hop on feed load.** Accepted: the feed is fetched once per
  session and the reader then swipes through a preloaded slate, so this is paid
  once, not per swipe.
- the Worker must forward the JWT and handle its absence
- until Phase 5 gives readers a durable server-side profile, the client must send
  a profile snapshot with the request. This is not a workaround: capturing the
  snapshot is required for replay regardless of where the profile lives.

Explicitly not done:

- **no production shadow-run.** The usual mitigation for moving a ranker is to
  run both paths in parallel and compare. With no deployed users that buys
  nothing. Because ranking is pure, equivalence is asserted as a unit test
  instead: identical inputs must produce an identical slate through both call
  sites. That is a stronger guarantee than a sampled shadow comparison, and it
  runs on every commit.

## Verification

- `feed.test.ts` asserts the Worker path and the browser path produce identical
  slates for identical inputs
- a schema assertion asserts every reader event carries a `feed_id` that exists
- a data-quality panel counts events without provenance and degraded traffic, so
  a regression in this decision is visible rather than silent
