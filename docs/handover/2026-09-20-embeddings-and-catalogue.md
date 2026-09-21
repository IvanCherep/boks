# Embeddings, and a new catalogue (2026-09-20)

Done the day before boks opens to ~30 real readers. Three things happened: the
ranker got the semantic source it was written around, the catalogue was
replaced with curated public-domain literature, and traffic was put on one
algorithm.

## 1. Embeddings

**Where they live.** `reels.embedding` is `vector(384)` (pgvector 0.8.2 in the
`extensions` schema), with `embedding_model` and `embedded_at` beside it and an
HNSW cosine index. Migration `20260920100000`.

**What the ranker gets.** `get_recommendation_candidates` returns two numbers
per candidate, both computed in SQL because the vectors must not travel - 200
candidates times 384 floats is half a megabyte per feed request:

- `tasteSimilarity` - cosine similarity to the reader's taste vector, which is
  the mean embedding of what they liked or finished, a like counted twice.
- `noveltyDistance` - cosine distance from the mean of their last 24 reads,
  halved into 0..1. This is the way out of a rut, and it is the thing genre and
  mood cannot see.

The taste vector is computed per request rather than stored: at this size the
aggregate is trivial, and a stored vector needs invalidation on every like,
read and re-embedding - a staleness bug invisible in the ranking it corrupts.

**How `for_you` uses them.** Its header used to say "No SEMANTIC source"; that
gap is closed. A candidate is classified `semantic` when its taste similarity
stands 0.75 sd above the rest of the set and the reader has at least two
liked-or-finished embedded boks, which makes the fourth retrieval family real:
a piece by an author the reader has never met, in a form they have no history
with, that reads like what they keep finishing. The score adds a signed
contribution from the **standing within the candidate set** (a z-score), never
the raw cosine - see the measurement below for why - and discovery candidates
get a small novelty bonus. A reader with no history is ranked exactly as
before: the terms are absent, not zero.

### The model, and why it is not the obvious one

The `embed` Edge Function (`supabase/functions/embed/index.ts`) uses
Supabase's built-in `gte-small` through `Supabase.ai.Session`. No API key, no
per-text price, nothing leaves the project. It works - and it is useless for
this catalogue, which is two thirds Russian. Measured on 4000 random
same-language pairs from the loaded catalogue:

| model | median similarity | sd | same author | different authors | gap |
|---|---|---|---|---|---|
| `gte-small` (Supabase built-in) | 0.894 | 0.020 | 0.895 | 0.893 | **0.002** |
| `multilingual-e5-small` | 0.880 | 0.018 | 0.884 | 0.878 | **0.0065** |

A 0.002 gap inside a 0.020 spread is not a weak signal, it is no signal: the
English model puts every Russian text in one blob, and its "nearest neighbours"
were a coin toss wearing a number. The neighbours from the multilingual model
read correctly by eye - a pine-forest lyric pulls Fet's night ravine and
Sluchevsky's vanished grove, a Mayakovsky poem pulls two more Mayakovsky poems,
a satirical sketch pulls Averchenko and Doroshevich.

So the catalogue is embedded with **`multilingual-e5-small`**, same 384
dimensions, run locally by `scripts/embed-catalogue.mjs` (ONNX on CPU, ~7 boks
a second, 447 in 67 s). `set_bok_embedding` now refuses any model other than
`boks_embedding_model()` (migration `20260920120000`), because two models in
one column is a silent failure: cosine between vectors from different models is
a number with no meaning, and the feed would simply be worse with nothing to
show for it.

**What this costs, and the way out.** New submissions do not get vectors on
their own any more - the Edge Function would be refused by the model check.
Until then the semantic terms are absent for them and the ranker falls back to
behaviour, which is safe but weaker. Options, in the order worth trying:

1. **Cloudflare Workers AI `@cf/baai/bge-m3`** - multilingual, called from the
   Worker we already deploy, on the paid plan bought this week. 1024
   dimensions, so the column and `set_bok_embedding` change together and the
   catalogue is re-embedded in one pass.
2. Supabase adding a multilingual model to `Supabase.ai`, at which point the
   Edge Function is one string away from being the whole answer again.
3. Running `node scripts/embed-catalogue.mjs` by hand after approving a batch
   of submissions. This is what to do this week; it takes a minute.

## 2. The catalogue

The 907 seeded boks are gone - every one of them, with their likes, comments,
views, feed items and recommendation events, which cascade. In their place,
**447 curated public-domain pieces**: 299 Russian, 148 English, 108 authors.

- Russian: Пушкин, Лермонтов, Тютчев, Фет, Блок, Анненский, Цветаева,
  Мандельштам, Есенин, Чехов, Куприн, Бунин, Тэффи, Аверченко, Гаршин and
  fifty more. 65 authors, no more than ten pieces each.
- English: Poe, O. Henry, Saki, Kate Chopin, Jack London, Bierce, Sherwood
  Anderson, Dickinson, Whitman, Tennyson, Yeats, Wilfred Owen. 43 authors.
- Median 1575 characters - a two-minute read; longest 13999.

Licence: authors dead before 1946 (Bunin 1953 and Teffi 1952 by the Russian
70-year rule), English works published before 1930 by authors dead before 1955;
no translations whose translator is not clearly out of copyright. Frost and
Masefield were dropped for failing that test although they were on the wanted
list.

Source and pipeline, all under `work/catalogue-2026-09-20/` (git-ignored):
`fetch_ru.py` and `fetch_en.py` pull from Wikisource's `action=parse` HTML -
`prop=extracts` silently drops `<poem>` markup and returns footnotes instead of
poems - and write JSONL. `scripts/build-catalogue-sql.mjs` validates it into
one SQL file: length, markup residue, scrape artefacts in titles, editorial
pages ("От автора"), a first line that only repeats the title, duplicates by
key and by opening. It writes the bok and its rights record in one transaction
and is idempotent on `import_key`.

**Publication dates are synthetic and interleaved.** Every piece here is a
classic, so a real date would be 1837, and the previous catalogue's dates
spanned four centuries, which made `freshness` meaningless. They are spread
over the past 30 days - and spread *per language*, because the first version
dated them in file order and the newest half of every slate came out entirely
English: a Russian-speaking reader opened the app on Tennyson. Verified after
the fix: the newest 60 boks are 40 Russian and 20 English, the catalogue's own
proportion, and a fresh guest slate served four of each.

### A second batch, 2026-09-21

**+100 pieces, chosen for the canon rather than for the filters**: 50 Russian
and 50 English, added to the 447 already loaded. The catalogue is now **547
boks - 348 Russian, 199 English, 138 authors**, all embedded under one model.

- Russian, 23 authors, 30 prose to 20 verse: Чехов (Хамелеон, Тоска,
  Злоумышленник), Салтыков-Щедрин (Премудрый пискарь, Коняга), Гаршин,
  Лесков, Тургенев (Бирюк, Порог), Грин (Зелёная лампа), Горький (Песня о
  Соколе, Песня о буревестнике), Блок (Незнакомка, На железной дороге),
  Пушкин (Анчар, Пророк), Лермонтов (Бородино), Гумилёв (Жираф, Капитаны),
  Есенин (Письмо матери).
- English, 30 authors: Lafcadio Hearn's Kwaidan, Melville, Twain, Kipling,
  Bierce, Chopin, Shakespeare's sonnets, Donne, Marvell, Marlowe, Byron,
  Burns, Gray's Elegy, Henley's Invictus, Emma Lazarus, Thayer's Casey at the
  Bat - and the fairy tales everyone knows, in translations that are
  themselves long out of copyright (Perrault via Lang 1889, Grimm via Hunt
  1884, Andersen via the Tegner edition).
- Licence exclusions worth recording, from the fetch: Зайцев (d. 1972),
  Ремизов (1957) and Вяч. Иванов (1949) were asked for and refused - still in
  copyright. On the English side Frost and Masefield stay out for the same
  reason.

Two things this batch exposed in what was already live, both now fixed:

- **Stress marks.** 33 Russian texts carried the combining acute (U+0301) that
  scholarly editions print over a stressed vowel. A reader sees "о́" and reads
  a typo - and because the mark is invisible to a naive comparison, it also
  defeated duplicate detection. Stripped from the catalogue and from the
  loader; the 33 were re-embedded, since changing the text drops its vector.
- **The duplicate it was hiding.** With the marks gone, Гаршин's
  "Лягушка-путешественница" turned out to be in twice - identical 8031
  characters, two import keys. The older copy was kept.

- **A poem titled by its opening lost that opening.** `stripRepeatedTitle`
  removed any first line equal to the title, which is right for an anthology
  heading ("550.Kubla Khan") and wrong for an untitled poem, whose title *is*
  its first line - "О доблестях, о подвигах, о славе…", "Мне нравится, что Вы
  больны не мной…", "Loveliest of trees, the cherry now". 19 of the loaded
  texts were missing their first line. The rule now strips only a heading that
  carries an index or stands in its own block with a blank line under it; the
  19 were rewritten from the source JSONL through the loader's new `--repair`
  mode (one implementation of the cleaning rules, not a second one that
  drifts) and re-embedded, and one poem that the old rule had shortened below
  the 400-character floor came back. Rated: it silently damaged the text of
  real poems, which is the worst class of defect this catalogue can have -
  nothing about a missing line looks broken.

The loader now carries **three duplicate guards** rather than one: the import
key, the byline plus title, and the normalised first 200 characters. Proven by
re-running the first batch against the loaded catalogue: 447 offered, nothing
written.

Two operational notes for the next batch: the database's SQL endpoint refuses
a request much over a megabyte (`413 request entity too large`), so a load or
a repair goes in files of 25-150 rows rather than one - `--repair` batches
itself for exactly this reason. And never split generated SQL by string
surgery on `;`: most verse lines end in one, so a chunker that splits there
produces invalid SQL, which is how 38 of 45 chunks were rejected on the first
attempt (they rolled back cleanly, nothing was half-written).

## 3. One algorithm

`for_you` takes 100% of traffic. `completion_first` stays registered at weight
0 in both the code default and the `recommendation_experiments` row, and the
seven other strategies stay in the registry. Existing assignments were moved
over too, so no returning test reader sits on the parked arm.

The reasoning is in `experiments.ts`: at 30 readers an arm holds 15, where the
power to detect even a large difference in reading time is near nothing, so a
split would cost half the audience a worse feed and answer nothing. Reopening
it is one number.

## Verification

- 361 unit tests, including five new ones for the semantic source: the closest
  piece ranks first and is labelled `semantic`; the vectors are ignored until
  the taste vector has two samples; a set with no vectors ranks identically to
  a build that predates the feature; a resume still beats a semantic match;
  and, among equals, the piece unlike the recent stretch wins.
- `scripts/local-supabase/checks.sql` gained nine assertions: the column is
  `vector(384)`, a wrong-sized vector is refused, an edited text drops its
  stale vector and is offered for embedding again, coverage counts, a reader
  with no history gets a null similarity rather than a zero, and a liked piece
  scores above 0.9 against its own taste vector while an unrelated one scores
  below 0.5.
- `npm run verify:schema`: **43 migrations, 313 checks, none failed.** The
  harness now runs `pgvector/pgvector:pg17`, because the official Postgres
  image cannot install the extension and Supabase's own image is amd64-only,
  so it exits immediately on an Apple Silicon machine.
- On production: the feed RPC returns the new fields, the catalogue is 447/447
  embedded under one model, and a guest walk through eight boks showed both
  languages, no console errors, 72 KB and 749 ms for the feed.

## What broke on the way, and is worth remembering

- **The feed RPC went down for about four minutes.** The first version declared
  `set search_path = public`, and pgvector's `avg(vector)` and `<=>` live in
  `extensions`, so every call raised `function avg(extensions.vector) does not
  exist` - the whole feed, not just the semantic part. Found by calling the
  function straight after the migration; fixed in `20260920103000`. A migration
  that touches an extension's types must run once before it is trusted.
- **The semantic migration silently reverted a language fix, and only the
  schema gate caught it.** `20260920100000` was built by copying the candidate
  RPC from `20260918100000` and adding the vector parts - but the live version
  was `20260918160000`, which had fixed two real things: an undetermined piece
  must not be served to a reader who narrowed their languages ("unknown is not
  yes"), and every candidate carries its `language`. Copying the older body
  put both back. For four hours production would again have offered English to
  a reader who asked for Russian only - it did not, because the new catalogue
  has no undetermined pieces at all, but that was luck, not design. Fixed in
  `20260920140000`, which is `20260918160000`'s body with the vectors layered
  on. **The lesson is mechanical: never rebuild a function from a migration
  you found by reading, only from the newest definition that defines it** -
  `grep -l 'create or replace function public.<name>' supabase/migrations | tail -1`
  and check what came after it.
- **The Edge Function's CPU budget is about three inferences.** 25 per call
  died with `WORKER_RESOURCE_LIMIT` after embedding two; 6 died; 3 takes two
  seconds and succeeds.
- `supabase functions deploy` hung on its Docker bundler with no output;
  `--use-api` bundles server-side and deployed in seconds.
