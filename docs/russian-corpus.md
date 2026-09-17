# The Russian Corpus

449 pieces of Russian literature — 34 authors, poems and short stories, each
inside the fifteen-minute promise — published on boks under `@boks`, beside the
457 English pieces.

Built from **Russian Wikisource** by two checked-in scripts, so the catalogue
can be extended or rebuilt rather than being a thing that happened once.

```bash
npm run corpus:fetch-ru                                    # download, once
npm run corpus:build-ru -- --out work/ru                   # convert, as often as needed
```

---

## Why not Project Gutenberg

Gutenberg supplied the English corpus and cannot supply this one. Its entire
catalogue holds **five** Russian-language texts, two of which are literature —
a volume of Derzhavin's odes and one Pushkin poem. Checked against
`pg_catalog.csv`, not assumed.

Wikisource holds thousands, and three things make it usable by a machine:

| | |
|---|---|
| Per-author, per-genre categories | `Поэзия Фёдора Ивановича Тютчева`, `Рассказы Антона Павловича Чехова` |
| A publication year per piece | the `Литература 1884 года` category, which is where the US copyright term comes from |
| Its own licence marker | `PD-old-70` |

---

## What is in it

| | |
|---|---|
| Pieces | 449 |
| Authors | 34 |
| Shape | 301 verse, 148 prose |
| Length | 221 to 19,742 characters; median 768 (about a minute) |
| Publication years | 1786 to 1925, 115 distinct |

Verse: Krylov, Pushkin, Lermontov, Tyutchev, Fet, Nekrasov, A. K. Tolstoy,
Apukhtin, Polonsky, Maykov, Blok, Yesenin, Bryusov, Annensky, Sologub,
Zhukovsky, Batyushkov, Nikitin, Pleshcheyev, Nadson, Koltsov.

Prose: Chekhov, Averchenko, Gorky, Leskov, Kuprin, Andreyev, Tolstoy,
Turgenev, Garshin, Mamin-Sibiryak, Korolenko, Saltykov-Shchedrin,
Dostoevsky.

Gogol is in the source list and contributed nothing: every one of his short
pieces runs past fifteen minutes. That is the filter working, not a gap.

---

## Why these works are free to publish

Three conditions. The first two are checked for every author in
`scripts/wikisource-sources.json`, where the reasoning sits beside each entry;
the third is checked per piece, by the builder, against the year Wikisource
files the page under.

1. **The author died before 1941.** Stricter than the English corpus's "died
   before 1955", and deliberately so: Russian law adds four years to the term
   for authors who worked during the Great Patriotic War. Nobody who died
   before it started can qualify, so the extension cannot apply to anyone
   here. This is what keeps **Bunin** out (d. 1953, in France through the war:
   protected in Russia until 2027) even though life+70 alone would admit him.
2. **The author was never repressed and posthumously rehabilitated.** For such
   authors the Russian term restarts from the year of rehabilitation, so
   **Gumilyov** (shot 1921, rehabilitated 1992) and **Mandelstam** (d. 1938,
   rehabilitated 1987) are protected in Russia into the 2050s and 2060s
   despite having died a century and most of a century ago. They are named
   exclusions, not oversights.
3. **The piece was published before 1929**, which is the US term. Per piece,
   from the `Литература NNNN года` category. A page with no year is refused —
   213 candidates were — because a piece that cannot show its date cannot show
   its term has expired.

Wikisource's own editorial contributions are CC BY-SA; the works themselves are
public domain. The converter strips the wiki's apparatus and keeps the work, so
what is published is the public-domain text. Provenance goes in each piece's
admin-only rights note, the same as the English corpus.

### The trap this guards against

The English corpus imported Irving Howe's introduction to *Winesburg, Ohio* as
a story, because a Gutenberg edition is public domain and an essay bound into
it is not. The Russian equivalent appeared immediately: Gorky's pages open with

> «Собрание сочинений в тридцати томах»: Государственное издательство
> художественной литературы; Москва; 1949

and that imprint was being served to readers as the first paragraph of the
story. Same failure, different costume. The builder now strips a leading
imprint block and refuses any piece carrying one further down.

---

## How the conversion works

The English problem was **splitting**: one Gutenberg file is a whole
collection, and a bok is one piece of it. Wikisource is the opposite shape —
one page is already one piece — so the work is getting the literature out from
under an infobox, an edition table, footnotes, scan links, and templates nested
three deep.

The rule that governs everything: **reject rather than repair.** There are
thousands of candidates and boks needs a few hundred, so any page the converter
is unsure about is dropped. A rejected poem costs nothing; a poem published
with `{{poem-title|XIII}}` still in it costs a reader, at the only moment the
product has to be good.

The converter is `lib/boks/import/wikitext.ts` and it has tests, because this
is where every bug was.

### What went wrong, and what each rule is for

Every rule exists because its absence produced broken literature. Six of these
were found by reading the output; two by tests written to guard the rules.

- **The body of a verse template is the parameter with line breaks in it.**
  `{{v||body|1829}}` and `{{poemx|title|body|date}}` disagree on position, and
  hard-coding either was wrong.
- **An unwrapped template body has to be scanned again.** This was the single
  biggest cause of rejected pages: `{{v}}` holds the poem, the poem holds
  `{{poem-section|<1>}}` stanza marks and `{{№|5}}` line numbers, and the scan
  had already moved past them. Fixing it took Tyutchev from 6 usable poems to
  22 and Nekrasov from 2 to 16.
- **An edition list is not a work.** `Silentium!` carries every poetry category
  there is and not one line of Tyutchev — the text lives on subpages. Lermontov's
  `Дума` heads its list `Авторские и издательские редакции текста`, which
  matched no known label, so the list was published as the poem. Collecting
  labels for ever is a losing game: **two subpage links** is the signal, since a
  work does not link two of its own printings.
- **Pre-reform orthography is a different reading experience.** `(ДО)` printings
  are refused, and so are `с ударениями` school editions with a stress mark over
  every word. A modern proofread edition is preferred, then the later one.
- **A heading is not always a template.** Krylov's fables print their collection
  and their numeral as bold lines *inside* the `<poem>` block, sometimes with an
  indent marker: `:'''Басни. Книга первая'''`. Stripping the bold markers first
  turned both into opening lines of the fable, and the indent marker had to come
  off before the heading rule could see the line at all.
- **A work that prints its own title is not printing a line of verse.** Tolstoy's
  page opens with `ПОСЛЕ БАЛА`; Wikisource titles an untitled poem by its
  opening line. Twenty-one poems printed their first line twice because the
  disambiguation was stripped in the wrong order: a hub variant is titled
  `На сердце злоба накипела (Плещеев)/РС 1862 (СО)`, and taking the trailing
  parenthesis off first removes `(СО)` and leaves `(Плещеев)` in the middle.
- **`ё` and `е` are one letter for that comparison.** Editions differ on the
  diaeresis, so without folding them the rule worked for some poems and not
  others.
- **A magic word is not a word.** `__NOTOC__` stood at the top of Garshin's
  story on the first run.
- **`\b` does not work near Cyrillic.** JavaScript defines a word boundary on
  ASCII word characters, so `/\bДО\b/` matches nothing at all — the pre-reform
  filter silently passed every such edition through, and the apparatus filter
  silently matched nothing. Caught by tests, not by reading.

### Validation

`--out` is a directory of Markdown files so the corpus is reviewable before
anything is imported, and the builder prints two lists to direct the reading:
the rejection reasons with counts, and **opening lines worth reading** — a
short first line with no terminal punctuation above a much longer body. That
list found the last two heading bugs; without it they were found by luck.

Checked on the final build:

- no two pieces share an opening;
- no piece carries template, link, HTML or entity markup;
- no piece is in pre-reform orthography, and none is mainly non-Russian;
- no piece repeats its title as its first line;
- **every verse piece renders as verse in the reader's own formatter**, which
  is the code that will render it rather than a guess about it;
- and a hand-read sample: Krylov's `Свинья под Дубом` ends on *Что эти жолуди
  на мне растут*, Chekhov's `Благодарный` on *Честное слово, искренно!*

---

## What this corpus exposed in the product

Three defects that an English-only catalogue could not show.

1. **The fifteen-minute promise did not hold in Russian.** `minutes` was
   `ceil(words / 238)` and the 20,000-character ceiling was derived from it —
   both English numbers. A Russian word is longer: measured over these 449
   pieces, **6.06 characters against English's 5.44**. So the same word count
   is more reading, and 115 of 449 pieces were understated, the worst by three
   minutes. `minutes` is now paced by characters (1,295 a minute, which is
   238 words at English's measured word length), so the ceiling is exactly
   fifteen minutes in any language and the English estimate is reproduced by
   construction — 398 of 457 English pieces keep the same value and none moves
   by more than a minute. See
   `supabase/migrations/20260919090000_boks_reading_minutes_are_language_neutral.sql`.
2. **The reader reflowed poems written in couplets.** It decided verse block by
   block, and Blok's `Предчувствую Тебя` leaves a blank line after every second
   line — so each block held two lines, below the three-line minimum, and the
   poem became a run of two-line paragraphs. Any poem in couplets breaks the
   same way in any language. The whole body now votes once and each block
   follows, while a block that looks like verse on its own still counts, which
   keeps a poem quoted inside a story rendered as a poem.
3. **Undetermined language was treated as a yes** — found while building this,
   and recorded in `docs/reading-languages.md`.

### A known characteristic, not a defect

Each piece carries its **real publication year** as its date, so the ranker's
freshness signal has 115 distinct years to read instead of one shared
timestamp. The side effect: the English corpus was published 1906–1922 and much
of the Russian is 19th century, so in the unfiltered candidate pool a
bilingual reader currently sees about two English pieces for every Russian one
(measured: 132 to 68). The random half of retrieval balances it, and a reader
who names one language is unaffected. Worth knowing before reading the feed as
evidence of anything.
