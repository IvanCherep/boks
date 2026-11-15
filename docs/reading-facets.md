# Reading facets

The data behind "Что почитать" (What to read): the reader asks for a mood, a
form and a group of authors, and the feed answers with boks that match. This
page owns the facet model, the rubrics' rules and how labels are made and
kept fresh. The reader-facing behaviour (the panel, Apply, the ribbon) is the
second stage and is not built yet.

## The model

A **facet** is one question about a bok with a fixed set of values. It has
one of three subjects:

| Facet | Values | Subject | Where the answer comes from |
|---|---|---|---|
| `mood` | `sad` (Погрустить), `fun` (Повеселиться), `think` (Подумать) | bok | a label read from the text, several values allowed, strongest first |
| `author_group` | `classics`, `contemporary` | byline | a label per byline as printed, one value |
| `format` | `prose`, `poetry` | derived | `reels.reading_shape`: `verse` is poetry, `short_prose` / `long_prose` are prose, `unknown` is neither |

Tables (`supabase/migrations/20261118120000_boks_reading_facets.sql`):

- `reading_facets`, `reading_facet_values`: the registry. Each facet has a
  `rubric_version`.
- `bok_facet_labels`: one row per bok and facet.
- `byline_facet_labels`: one row per byline and facet.
- `bok_reading_facets`: a view with one jsonb object per bok, e.g.
  `{"mood": ["sad", "think"], "format": ["poetry"], "author_group": ["classics"]}`.
  A request matches when, for every facet it names, the bok's list shares a
  value with it (`facets -> 'mood' ?| array['sad']`). Different facets combine
  with AND, values inside one facet with OR.
- `get_reading_facet_coverage()`: for admins, how many published boks carry
  each value, how many are labelled "none", unlabelled, or due again.

A trigger refuses any label whose facet does not belong to that table's
subject, whose value is not registered, which repeats a value, or which gives
a single-valued facet two values. Nothing is readable through the Data API:
the feed will read the view inside its own security definer function.

### Rules that keep labels honest

- **No row means unknown, an empty list means "none of these".** A filter
  never matches an unknown bok. Unknown is never turned into a default
  (an unlabelled byline is not `contemporary`).
- **An editor's label is final.** `source = 'editor'` rows are never
  overwritten by a model; every bulk load and job writes
  `on conflict ... where source <> 'editor'`.
- **Every label records its basis:** `labeler` (model id or editor),
  `rubric_version`, and for bok labels `text_hash`
  (`boks_bok_text_hash(title, text)`). A label is **due** again when its
  facet's `rubric_version` is raised or the bok's text changed.
- **Author groups are per byline, never per account.** The catalogue account
  publishes every classic; a living author's own account is a hint, not the
  rule. Two spellings of one author are two rows.
- **Not reused:** the old `reels.mood` (`quiet`, `warm`, `tense`, `strange`,
  `playful`) is a different vocabulary and is not mapped onto these facets;
  upload date and portraits say nothing about an author's group.

## The rubrics

The words a labeller decides by live in `lib/boks/facets/rubric.ts`
(`moodRubric`, `authorGroupRubric`), in Russian. The mood test for every
value: "The reader pressed this button and the feed opened this bok. Did they
get what they asked for?" Only a confident yes counts.

Changing what a value means: edit the rubric, raise `rubricVersion` there and
`reading_facets.rubric_version` in a new migration. The coverage function then
reports every older model label as due.

## Adding a facet or a value

1. A new forward migration: a row in `reading_facets` and its values in
   `reading_facet_values`. Nothing else in the schema changes; the view picks
   it up.
2. Its entry and rubric in `lib/boks/facets/rubric.ts`.
3. Label the published boks (below), then expose it in the request contract
   and the panel.

Removing a value: first delete or relabel the rows that use it, then the
value row (the trigger would refuse labels with it anyway).

## How labels are made

### First labelling, 2026-11-16

- All 238 published boks exported read-only from production.
- `mood`: eight Claude Sonnet subagents, about 30 boks each, every text read
  whole, under rubric v1, `labeler = 'claude-sonnet-5-5'`, each with a short
  `note` explaining the decision. About 110k tokens and one minute per agent.
- `author_group`: the 100 bylines, by hand-checked rule:
  all 98 catalogue authors died before the mid-20th century (`classics`); the
  two living authors who publish from their own accounts are `contemporary`.
- Loaded with `deploy/sql.sh` (dry run first). After the load: 238 of 238
  published boks have a mood label and an author group, no stale hash.

Result: `sad` 83, `think` 76, `fun` 38, none 69 (a bok can have two).
`contemporary` covers 15 boks, all by two poets: a request for
contemporary prose finds nothing today. A bok whose dominant feeling is
horror, heroism, love or plain joy usually has no mood: the three buttons do
not ask for it. That is the strongest signal for a fourth mood value.

### New boks: the `facets` job

`deploy/embedder/facets.mjs`, run by `deploy/ops/embed.sh` every 15 minutes
right after the embedder, in its own container (`facets` in
`deploy/compose.yml`, half a core, 256 MB) and skipped while
`flags/busy.on` is up. It labels what is due, at most 40 boks and 20 bylines
a run: a published bok with no mood, or a model's mood written under an older
rubric or for a text that has changed; a byline with no author group. Every
run is a row in `background_job_runs` (job `facets`, details carry the token
usage and the labels); a failure is reported once to Telegram. The rubric and
the request code are bundled from `lib/boks/facets/job.ts` by each release
into `/opt/boks/embedder/facets-lib.mjs`.

`node facets.mjs --calibrate 60` (in the container) asks the model about 60
already labelled boks, writes nothing and prints the agreement per value;
`FACETS_MODEL` picks another Yandex model for it.

**Calibration, 2026-11-16** (60 boks, reference = the first labelling):

| Model and question | Exact match | `sad` both / extra / missed | `think` both / extra / missed |
|---|---|---|---|
| Alice AI, one list | 24 | 13 / 23 / 1 | 20 / 7 / 5 |
| YandexGPT, one list | 31 | 10 / 8 / 4 | 21 / 13 / 4 |
| Alice AI, a verdict per value | 24 | 13 / 16 / 1 | 25 / 20 / 0 |
| **YandexGPT, a verdict per value** | **35** | 11 / 6 / 3 | 23 / 12 / 2 |

`gpt-oss-120b` is refused (403) for the server's key. Alice AI calls nearly
every text sad and thoughtful, so the job uses YandexGPT with a verdict per
value (`labeler = 'yandexgpt'`). It is the weaker labeller: it adds `think`
too readily. Its labels are told apart by `labeler`; to raise quality, review
them in Studio (an editor's label is final) or re-label with a stronger model
when the key allows one. A run of 60 boks costs about 100k input tokens.
