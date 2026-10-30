# A1: liking after reading

## Protocol

A1 v3 (`a1-post-reading-liking-v3`) replaces the next-reading choice. Each
participant reads both members of two randomly drawn matched prose pairs:
two complete short works and two coherent excerpts. Order is ABBA/BAAB,
chosen by the existing condition; pairs and order replay from the same seed.
The pool must contain at least four distinct pairs. Studio checks publication,
unique ids, word-count difference within 10% and at most five estimated
minutes per text. Genre, theme, difficulty and meaningful excerpt boundaries
need an editorial check. Recruitment is for readers aged 18-35.

After each text: «Насколько вам понравился этот текст?», 1 «Совсем не
понравился» to 7 «Очень понравился», plus the existing prior-familiarity
checkbox. No format labels or expected winner are shown. Only after all four
primary ratings are saved are closure and context asked, optionally. Those
questions describe the reading experience; they do not establish its cause.
There is no visible timer or new-text choice. Estimated study time is 25 min.

## Analysis and compatibility

One paired observation per participant: the share of ratings 6-7 for whole
works minus the share for excerpts. Criterion: at least +15 pp and lower
95% paired interval above zero. Full-scale participant means are secondary;
optional closure/context results are also paired participant means.

The first response per bok is taken chronologically, including after a
reload. Four distinct valid ratings are required, two per kind and both
members of two pairs. A known text excludes that participant's set from the
new-text primary analysis. Missing/invalid sets and known-text sets are
counted; missing ratings are never zero. Diagnostic answers are not required
for the primary sample. Earlier instruments stay in the raw export and never
enter v3. The old `choices` material field may remain in stored JSON but is
ignored and not loaded. No schema change or study activation is needed.

## Visuals

The gallery uses the actual reader and rating components, one example pair
and an explicit explanation that everyone reads another pair too. The
«Бирюк» example ends when the forester lights the lamp: 600 source words
against the whole example's 553, within 10%. This replaces the automatic
nearest-paragraph prefix; it is still not an approved research material set.
Sixteen published catalogue works are loaded across A1-A3, in a bounded read.
A1 gallery screens use 375×667. Screenshot artifacts and Google Slides edits
are kept outside the repository in
`/Users/andrey/Downloads/Boks_A1_liking_2026-10-30/`.

## Validation and release

`npm run check`: 1367 passing tests, 15 existing skips; no lint errors.
The A1 results tests check participant-level aggregation, repeat responses,
earlier instruments, missing/invalid ratings, known texts and the confidence
interval criterion. `npm run verify:schema`: 64 migrations, 451 checks pass.
Production build and deploy-target checks pass. No migration is added.

Local form renders use the real React components and source styles at
375×667, verified in the in-app browser with clean screenshots. Production
UI verification and the release identifier are recorded after deployment.
All studies must remain off; final materials and the pilot are still needed.

The complete A1 UI flow was also exercised locally with cached public texts
and data access replaced by an explicit local-only adapter: four readings,
four immediate liking ratings, then four optional diagnostic screens. The
captured payloads contain four `liking` rows followed by four `details` rows,
whole/fragment/fragment/whole, all v3. No answer was sent to production.

The existing Google Slides A1 hypothesis, methodology and visuals were edited
in place; adjacent A1 statements and sample planning were aligned. Source
comments and notes are preserved. Concurrent user edits, including removal
of the visual's redundant footer metric, are kept.
