# Andrey's study forms and presentation

## Shipped behaviour

- A1 reads two texts, offers one new whole work and one excerpt or neither,
  then asks closure of the first two texts. Neutral format labels make the
  format identifiable; both options use their opening text. The Continue
  action does not claim that a work was finished.
- A2 compares illustrated cards opening a reader with full texts in the
  feed. Each participant gets both ten-minute sessions with counterbalanced
  order and disjoint comparable sets. There is no visible countdown or
  separate arrow/counter dock. The product cover, adaptive `CoverHeading`,
  artwork, typography and navigation intent helpers are reused. A background
  session limit opens the survey; foreground reading remains measured
  separately. Touch swipes, horizontal trackpad movement, keyboard navigation,
  the cover's own hint and the end-of-text action switch works.
- A2 asks for one chosen work among those actually displayed, or an explicit
  refusal, then ease of choosing. Primary success requires a choice and ease
  6 or 7 of 7. Refusals stay in the denominator; missing or invalid answers
  are excluded and counted. Choice satisfaction and stated completion are
  secondary. Old instruments remain in export and are not pooled with v2.
- A3 reads through the cover/reader surface and asks interest on leaving a
  text. A skipped cover records zero observed reading. The profile freezes
  after five ratings; the ten test texts remain independent of both predicted
  orders. The gallery's admin-only demonstration uses the same `rankA3`, real
  snapshot vectors/counters and explicitly labelled adjustable example
  ratings. It saves no research answers. Changing a rating was verified to
  change the personalised order and restoring it restored the order.
- A1, A2 and A3 primary criteria require both their point-estimate threshold
  and a positive lower paired 95% interval. The upstream B2 interval fix is
  retained, as are the other concurrent RG2, B2 and B3 changes.
- The gallery uses a bounded set of 17 published works and their exact cover
  assets. Gallery A1 excerpts retain the source verbatim, end at a paragraph
  boundary and use the shared reading-duration estimate. These are examples
  of the procedure, not an approved experimental material set.

## Verification

`npm run check` passes: 1366 tests, 15 existing skips, no lint errors. Existing
lint warnings concern raw image tags and an unrelated navigation call.
`npm run verify:schema` passes with 64 migrations and 451 checks; no migration
was added or changed. Production build and deploy-target checks pass.

Production browser checks cover the illustrated card, direct full text,
card-to-reader and back, a physical horizontal drag changing the work, the
absence of a countdown/dock, A1's sequence screens and A3's real-vector
comparison. The gallery never writes participant responses. Full participant
data collection is still a pilot task after materials are approved.

Production HTTP checks: `/`, `/admin`, `/series` and `/study/a1` through
`/study/a3` return 200 with the expected security headers. An unauthenticated
POST to `/api/feed` returns 401. Deployment uses the current source and
`--keep-vars`; the production Worker is `read` in account
`de648d4e4cfa65bbee43e2170594e2de`. No study switch was changed.

## Presentation

The existing combined Google Slides deck is edited in place:
https://docs.google.com/presentation/d/1wk7Q0870n7QKahy2bnAMxinZxDh7P6sxndfFg9yM2Q0

- `boks_review_20261026_demo_a`: the existing screen slide now shows A1's four
  stages and follows the A1 method. Original slide and element IDs survive.
- `boks_study_20261030_a2`: the same real work in card and direct-text modes,
  with the primary questions and decision criterion.
- `boks_study_20261030_a3`: native editable comparison diagram with real
  catalogue images and the two example orders observed in the live gallery.
- A1/A2 methods, study status and the individual slide numbering are aligned.

The 71 original slides remain; two new slides are added. Existing notes are
preserved. All 18 comment threads, authors, anchors, replies and resolved states
were checked unchanged. Local screenshots, native readbacks, edit plans and
rendered proofs are under
`/Users/andrey/Downloads/Boks_study_forms_2026-10-30/` and are not committed.

## Research still to do

Approve A1's four matched pairs and separate choice pool, A2's comparable text
sets, and A3's eligible vector-covered pool before enabling their links. Run
the pilot to check wording, material comparability, fatigue and interval
width. The gallery and slides demonstrate a working procedure; they do not
claim that any hypothesis has already been confirmed.
