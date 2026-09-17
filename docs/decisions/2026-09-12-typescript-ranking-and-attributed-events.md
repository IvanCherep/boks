# ADR 2026-09-12: TypeScript ranking, attributed Supabase events, database-backed traffic split

## Context

The MVP had two recommendation implementations that could not be compared:

- The D1 compatibility path built a SQL `ORDER BY` per algorithm from weight
  constants, and recorded rich attributed events into the D1 `events` table.
- The Supabase production path - the one real readers use - served newest-first
  and recorded only `views`. It reported a fake `supabase_recent` row in the
  admin "Recommendation lab", with `completes: 0` and `finishRate: 0` hardcoded.

So the founder could not answer the question the product exists to answer. The
architecture review had already named the fix: attributed event tables,
assignment tables, and moving comparison off D1-shaped events.

Adding an algorithm also cost four edits in three files, including a hand-written
SQL expression per strategy - a shape that gets worse with every algorithm.

## Decision

**Ranking moves out of SQL into one TypeScript module.** The database returns
candidates with behavior counters; `lib/boks/recommendations/feed.ts` scores and
orders them. Both backends call the same `buildReaderFeed`.

**Strategies score normalized signals, not raw counters.** `signals.ts` derives
seventeen `0..1` signals per candidate. A strategy is a name, a description and a
weight map; `defineStrategy` turns that into a scorer. `score` and `rerank` stay
available for strategies that are not a linear blend.

**The registry is the single source.** `strategies/index.ts` lists the registered
strategies; the algorithm id union type, the admin lab, the traffic split editor
and event attribution all derive from it. Adding an algorithm is one file plus
one line.

**Attribution becomes real on Supabase.** `recommendation_events`,
`recommendation_assignments` and `recommendation_experiments` land with RLS:
readers write events only through a batch RPC that stamps `user_id` from the
session, and only admins can read the stream or change the split.

**The traffic split is data, not code.** An admin edits weights in `/admin`;
assignment stays deterministic per reader. Comparing a new strategy against
control no longer needs a deploy.

**SQL returns counters; rates are derived in TypeScript.** `finishRate`, uplift
and the confidence label are computed in `metrics.ts`, so the two backends cannot
drift apart on what a metric means, and the math is unit-testable with no
database.

## Consequences

Easier:

- A new algorithm is one file, one list entry, one test case.
- Recommendation logic is testable offline. `npm test` covers ranking,
  assignment, metric math and the event queue with no database and no network.
- The Supabase reader can personalize, because the ranking runs where the
  reader's local behavioral profile already lives.
- Migrations are verifiable offline: `npm run verify:schema` applies every
  migration to a throwaway Postgres container behind a small Supabase shim.

Harder or deferred:

- Ranking now needs the candidate set in memory. `get_recommendation_candidates`
  is bounded at 400 newest published boks and 60 days of events. Past that,
  precomputed daily rollups are required - that is the next metrics step.
- `get_recommendation_lab` aggregates the raw event stream on every load. Same
  rollup answer, same trigger.
- `get_boks_admin_snapshot` still emits stale `algorithms` and `algorithmMetrics`
  keys describing the old `supabase_recent` row. Nothing reads them; they should
  be dropped the next time that function is rewritten for another reason.
- The D1 path is no longer a *different* implementation, only a different data
  source. That makes removing it later a smaller decision, not a bigger one.

## Also fixed here

Upgrading an anonymous Supabase session to a permanent account left the old
access token in place, and that token still claimed `is_anonymous: true`. Every
RPC that gates on a permanent account - profile updates, comments, likes, bok
submission - refused the account that had just been created. Sign-up from
`/author` was therefore broken end to end. `createOrUpgradeBoksUser` now
refreshes the session after an upgrade, and
`lib/boks/supabase-flow.test.ts` covers the path.
