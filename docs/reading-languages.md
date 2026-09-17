# Reading languages

How boks decides which language a reader is offered, and why the decisions are
what they are. Read this before touching retrieval, the account panel, or the
language columns in the console.

## The problem

Three kinds of reader have to be comfortable at once:

- reads only English, and should never be shown Russian
- reads only Russian, and should never be shown English
- reads both, and should be shown both

A piece in a language the reader cannot read is not a weak recommendation. It
is not a recommendation at all: there is no score low enough to represent
"these words are opaque to this person". So language is a **filter in
retrieval**, never a term in the ranker. `get_recommendation_candidates` applies
it in the `published` CTE, before anything is scored, which also means the
catalogue-headroom figures count only what was ever eligible for that reader.

## Where the default comes from

The browser. `navigator.languages` for a Russian-speaking reader almost always
already reads `["ru", "ru-RU", "en-US", "en"]`, so a bilingual reader gets both
languages and an English-only reader gets English, with nothing asked of either.

The alternative was an onboarding question. It was rejected: the one promise the
product makes is that you open it and read, and a correct-in-theory question
placed in front of that promise costs more than it collects. The default is a
starting point and nothing more - it is stored the moment a reader changes it,
and from then on their choice is what counts.

The setting is mandatory and always reachable: **account panel -> Languages you
read**, as pills carrying the number of boks behind each language.

## Where the choice is stored

| Reader | Stored in | Notes |
|---|---|---|
| Signed in | `user_profiles.reading_languages` | Follows them between devices |
| Guest | `localStorage`, sent as `p_languages` | No profile row to write to |

A signed-in reader's stored value **wins over whatever the client sends**. That
is what makes the setting follow the person rather than the browser they
happen to be holding.

An empty array means **all**, never **none**. A filter that can silently empty
the feed must be impossible to set by accident, so `set_my_reading_languages`
normalises region tags (`ru-RU` -> `ru`), drops unsupported ones, and treats the
empty result as "no filter".

## Unknown is not a yes

`boks_detect_language` returns `und` when it will not commit. Eligibility:

- a reader who **named no language** sees everything, `und` included
- a reader who **narrowed** sees only what they named

The first version had it the other way round - `und` was eligible for everyone,
on the reasoning that hiding a piece because the classifier shrugged is worse
than showing it. That reasoning is right for a ranking signal and wrong for
this one. On production it served twenty English poems to a reader who had asked
for Russian only, breaking the single promise the feature makes.

The cost of the stricter rule is that an unlabelled piece reaches fewer readers,
so the console makes it a work queue: **Admin -> Catalogue -> What to acquire
next** lists the `und` count with "hidden from every reader who set a language -
label these", and `set_bok_language` sets one by hand.

The same screen is what said `en 457, ru 0` for a day, which is how the Russian
corpus came to be built. See `docs/russian-corpus.md`.

## How the detector works, and how it was wrong

Cyrillic against Latin settles Russian from English. Latin script alone would
call Spanish English, so English is confirmed by function words.

The first version searched the **raw text** for `' the '`, `' and '` and so on,
and required three. That is not a test for English, it is a test for prose: in a
paragraph a function word is surrounded by spaces often enough that any bar is
cleared, and in a quatrain almost every word sits against a line break or a
comma. All 437 prose pieces passed and all 20 poems failed.

The current rule collapses every run of non-letters to a single space first,
then asks for three matches from a longer list of words that are common in
English and are **not** words in Spanish, Italian, French, German or Latin.
`in`, `me`, `or`, `was` and `a` are deliberately absent: each is a real word in
at least one of those.

Three is not a guess. Scored over the live catalogue and five control passages:

| | markers |
|---|---|
| lowest-scoring English piece (`Unreturning`) | 5 |
| 5th percentile / median English piece | 10 / 31 |
| Spanish control | 1 |
| Italian, French, German, Latin controls | 0 |

There is an empty gap between 1 and 5, and the bar sits in the middle of it:
every one of the 457 pieces is recognised, every control stays `und`, and there
is room for a poem shorter than any we currently hold. After the fix production
held 457 `en` and zero `und`; with the Russian corpus loaded it holds 457 `en`,
449 `ru` and still zero `und`, with no piece misfiled in either direction.

It distinguishes **scripts and a word list**, not languages in general. A sixth
language needs more than a new entry in `supportedReadingLanguages`.

## The empty feed says so

A reader whose filter leaves them nothing is told, and offered the one-tap way
out ("Add English") plus a way into the setting. The alternative - quietly
adding a language back - would break the promise; and a reader who asked for
Russian and found none is the most useful thing the console can learn about what
to acquire.

That decision lives in `emptyFeedNotice` (`components/boks/reading-languages.ts`)
as a pure function, because the first version lived in the reader and was keyed
on the **text** of the status message. Status is a message channel - it also
carries "Link copied", a copied URL and every error - so the rule broke silently
the moment the settled message was `Ready`, and the reader saw the bare word
with no explanation and no way out. `useBoksData` now exposes `phase`
(`loading | ready | failed`) alongside `status`, and only a load that *succeeded*
can be called empty: telling a reader that nothing exists in their language,
when in truth the request never arrived, is the worse of the two wrong answers.

## Files

| Where | What |
|---|---|
| `supabase/migrations/20260918100000_boks_reading_languages.sql` | column, detector, profile field, coverage and demand RPCs |
| `supabase/migrations/20260918160000_boks_unknown_language_is_not_yes.sql` | the two corrections above |
| `components/boks/reading-languages.ts` | normalisation, browser default, guest storage, empty-feed rule |
| `components/boks/reader-feed.tsx` | sends the set with the feed request, renders the empty state |
| `components/boks/user-auth-panel.tsx` | the pills, saved immediately |
| `components/boks/admin/catalogue-import.tsx` | supply and demand table |
| `lib/boks/feed-service.ts` | carries `readingLanguages` to `p_languages` |

## Adding a language

1. Add the tag to `supportedReadingLanguages` and a name to
   `readingLanguageNames`.
2. Teach `boks_detect_language` to recognise it - a new script is a new branch;
   a new Latin-script language needs its own function-word list **and** a
   control passage proving the existing languages do not claim it.
3. Add it to the `lang in ('en', 'ru')` allow-list in
   `get_recommendation_candidates` and in `set_my_reading_languages`.
4. Extend the assertions in `scripts/local-supabase/checks.sql`: detected
   correctly, not claimed by another language, and excluded from a reader who
   narrowed elsewhere.
