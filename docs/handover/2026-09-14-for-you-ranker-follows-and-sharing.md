# Handover — the `for_you` ranker, author follows, shareable boks

Date: 2026-09-14
Status: complete, verified locally. Nothing deployed, nothing committed.

Three things landed: the ranking from the original boks backend ported into this
codebase's strategy framework as the product ranker, author follows, and a real
per-boks share link. The first needed the other two, plus a fair amount of
plumbing that did not exist.

---

## 1. `for_you`, ported

`lib/boks/recommendations/strategies/for-you.ts` plus
`lib/boks/recommendations/reader-profile.ts`. The original was Kotlin over four
SQL retrieval queries; this is one pure function over the candidate set, with
the original's weights preserved.

It fits the existing framework exactly — it is registered in
`strategies/index.ts` like any other, gets traffic from the same experiment
config, is compared by the same reader-level statistics, and is measured by the
same divergence gate. Nothing about the experiment machinery needed changing.

What it does differently from every other strategy here:

- **`score` is a sum of explained contributions, not a weight table.** Each
  placement carries up to four human-readable reasons, stored per slot in
  `served_feed_item.explanations`.
- **`rerank` is a greedy slate.** Every pick is scored against what is already
  placed, so author streaks, shape streaks and the exploration budget are
  decided in context. A long piece after a run of compact ones is rewarded.
- **It opts out of the shared fatigue tiering** and handles reading fatigue with
  its own graded skip penalty.

### What is not ported, and why

- **The `semantic` retrieval family.** Embedding similarity against a reader's
  positive and negative taste vectors needs a provider and a per-user budget.
  The family is declared in the type so the gap is visible.
- **`NOT_INTERESTED` and `HIDE_AUTHOR`.** Worth 3.6 and 4.8 of negative weight
  in the original. This product has neither control, so the negative half of the
  profile rests entirely on implicit evidence.
- **Retrieval itself.** At 38 items every ranker sees everything, so `source`
  classifies a candidate rather than describing where it came from.

### Two additions the port required

The original relied on its retrieval queries to exclude finished pieces. A
ranker over the whole corpus cannot, so it has to say so explicitly:

1. progress no longer boosts a boks the reader already finished — progress is
   evidence for *resuming*, and there is nothing to resume;
2. a finished boks is demoted outright (3.0, or 1.8 if it was liked — rereading
   something you loved is a smaller mistake).

Both were found by a test, not by reading: without them the best-read boks in
the corpus is served straight back to the reader who just finished it.

---

## 2. What the ranker needed that did not exist

**Per-reader, per-boks state on the server.** Previously in `localStorage`,
which meant the same person on a second device was ranked as a stranger.
`get_recommendation_candidates` now returns the caller's own history with each
boks — sessions seen, quick skips, dwell, furthest progress, liked, commented,
completed — derived from the event stream rather than stored again. Cumulative
`active_seconds` already rolls up with `max()`, so duplicates stay free.

**Reading shape, derived from the text.** `verse` / `short_prose` /
`long_prose` / `unknown`, from line breaks, average line length and the share of
short lines. This also fixes a measurement error: a 238 wpm estimate labels a
poem as skipped almost every time. The form is a measurement, never a
declaration — the same rule `minutes` already follows.

**A pre-existing bug, found on the way.** `boks_word_count('')` returned **1**,
because splitting an empty string on whitespace yields one empty element. Empty
text therefore counted as a one-minute boks. Fixed; asserted.

**Provenance for explanations and sources.** `served_feed_item` gained
`candidate_source` and `explanations`, and the profile snapshot now records the
server-side half of what the ranking saw — without it a slate cannot be replayed.

---

## 3. Author follows

`author_follows` + `set_author_follow` + `get_my_followed_authors`, with RLS so
follows are private to the reader who made them. Anonymous readers are refused
by the database: a follow is a durable relationship and an anonymous session is
not a durable identity — the reader is asked to create an account instead.

Following feeds the ranking in two places: a direct boost, and standing positive
evidence in the reader profile, which cancels any negative weight for that
author.

---

## 4. Shareable boks

The share action produced `window.location.href` — the feed root — so a shared
link opened a *different* boks for whoever received it. There were no per-boks
URLs at all.

Now `/b/<id>` exists and the share action produces it. The route hands the id to
the reader, which already knew how to open a boks by id, and strips it from the
address bar so a refresh does not re-pin it over the reader's own feed.

---

## 5. The live split changed, on a measurement

`for_you` is the control: it is the product ranker, so a challenger has to beat
what readers actually get.

The challenger is `completion_first`, **not** `recency`. `recency` is the
pairing a young product would normally want, and it was measured and rejected:

| pair | cold reader | reader with two weeks of history |
|---|---|---|
| `for_you` vs `recency` | 100% overlap (τ 0.85) | 80% (τ 0.35) |
| `for_you` vs `balanced` | 80% (τ 0.46) | 60% (τ 0.27) |
| `for_you` vs `completion_first` | 40% (τ 0.14) | **30% (τ 0.07)** |

On this corpus almost nothing separates `for_you` from `recency`: every seeded
boks is the same length, only one has an author account, and no author has
published enough to move the cold-start prior — so freshness is most of what
either ranker has to work with.

The second column is worth noting on its own. It is the **cause attribution the
divergence gate cannot yet do**, performed by hand: injecting a synthetic reader
profile separates "identical by construction" from "no signal to differ on".
`for_you` does personalise — divergence rises materially once there is history —
and the residual agreement with `recency` is the corpus, not the ranker.
Automating that substitution is the obvious next improvement to the gate.

Revisit the pairing once the catalog carries varied lengths and real authors.

---

## Verification

```
npm run lint                 clean
npx tsc --noEmit             clean
npx vitest run               145 passed, 9 skipped   (+24: for_you, reader profile)
npm run verify:schema        17 migrations, 90 schema checks passed
npm run test:supabase        9 passed against the local stack
npm run build                /b/:id registered as a dynamic route
```

By hand against `npx supabase start`:

- `POST /api/feed` served a `for_you` slate, wrote provenance with per-slot
  sources and explanations;
- the Follow button prompted an anonymous reader to create an account, with
  follow-specific copy;
- `/b/<id>` opened the linked boks rather than the top of the feed.

### One thing to know about the local stack

`.env.production.local` — the override that points the local build at
`npx supabase start` — **had disappeared**, so a local build silently fell back
to `.env.local` and pointed the Worker at the real Supabase project. Requests
were rejected (a locally minted token against the real project), so nothing was
written there, but the failure mode is worth naming: it is the same class of
problem as the silent D1 fallback removed in Phase 1 — a missing local override
downgrading to production without saying so. The file has been restored with the
Supabase CLI's fixed local development keys, which are not secrets.

---

## Follow-up: identity was stored twice (fixed 2026-09-14)

A byline lived in `user_profiles` and again as a copy on every boks and every
comment. Nothing kept the copies in step. Measured on a development database:
two of six authored boks and one of four comments had already drifted.

The copies were not laziness - row-level security lets a reader read only their
own profile, so a copy was the only way an author's name reached the reader
rendering their work. The fix was therefore to give identity a sanctioned
public projection first, then delete the copies:

- `boks_public_identity` - display name and @handle, the two fields already
  printed on every boks and comment. Nothing else on the profile is exposed.
- `comments` lost `visitor_name` and `visitor_handle` outright. Every comment
  has an account, so there was never a case that needed them.
- `reels` keeps a byline only for rows with no account - the seeded catalog -
  and a CHECK makes the two mutually exclusive. A boks with an author *cannot*
  carry a stale copy. Two `DEFAULT`s (`'boks'` and `''`) were what put a copy
  there even when nothing wrote one.
- `boks_reels`, `published_boks` and `boks_comments` resolve the byline at read
  time; six RPCs and every browser read now go through them. `loadReaderLibrary`
  became an RPC, because a PostgREST embed cannot resolve a joined byline.

Verified by renaming a profile and watching the name change on both a boks and
a past comment with no backfill. Asserted by five new schema checks, including
one that fails if any row ever stores a byline it could drift from.

**Stated, not solved:** there is no delete-account flow, and
`reels.author_user_id` is `on delete set null`, so a deleted author would leave
published boks with no account and no byline. The obvious constraint
(`author_user_id is not null or author_name is not null`) would express the
invariant exactly and would also make deleting an account fail, so it is a
schema assertion instead of a constraint.

## Still missing, in order of what the ranker would gain most from

1. **Explicit negative feedback** (`not interested`, `hide author`). The single
   cheapest source of the variance this corpus lacks, and the negative half of
   the ported profile is currently inert without it.
2. **Semantic embeddings** and the negative taste vector. Deferred deliberately:
   at 38 boks they do not address the binding constraint, and they add an
   external dependency with a per-request cost.
3. **A cursor for the feed**, so it stops wrapping modulo the catalog. The wrap
   is what makes finish rate fall mechanically the longer someone reads.
4. **Drafts**, author pages, and content reports — product surface the original
   had and this one does not.
