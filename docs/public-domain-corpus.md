# The Public-Domain Corpus

457 pieces of real English literature — 24 authors, poems and short stories,
each inside the fifteen-minute promise — published on boks under `@boks`.

Built from Project Gutenberg by two scripts that are checked in, so the
catalogue can be extended or rebuilt rather than being a thing that happened
once.

The Russian half of the catalogue - 449 pieces, 34 authors - comes from
somewhere else entirely, because Gutenberg holds five Russian texts in total.
See `docs/russian-corpus.md`.

```bash
npm run corpus:fetch -- 2776 2814 269          # download, once, and report what each file is
npm run corpus:build -- --cache <dir> --out <dir>
```

---

## What is in it

| | |
|---|---|
| Pieces | 457 |
| Authors | 24 |
| Shape | 239 verse, 218 prose |
| Length | 220 to 19,348 characters; median 2,443 (about two minutes) |
| Reading time | 1 to 14 minutes |

Prose: O. Henry, Saki, Katherine Mansfield, Kate Chopin, Ambrose Bierce,
Sherwood Anderson, W. W. Jacobs, H. G. Wells, James Joyce, Stephen Crane,
Jack London, Anton Chekhov, Edith Wharton, Arthur Conan Doyle, Oscar Wilde,
Paul Laurence Dunbar, Thomas Hardy.

Verse: Emily Dickinson, Shakespeare's sonnets, Sara Teasdale, William Blake,
Edna St. Vincent Millay, Walt Whitman, Rupert Brooke, Christina Rossetti,
Paul Laurence Dunbar.

Each piece carries the **real author as its byline** and is published by the
`@boks` account. That is the publisher model: readers follow the account, and
every piece says who wrote it.

---

## Why these works are free to publish

Two conditions, checked for every source in
`scripts/public-domain-sources.json`, where the reasoning sits beside each
entry rather than in code:

1. **Published before 1929** — public domain in the United States.
2. **Every author *and translator* died before 1955** — so the works are also
   out of copyright in life+70 countries. The Chekhov stories are Constance
   Garnett's translations (d. 1946), and a translation carries its own
   copyright; that is why the translator's date matters as much as the
   author's.

The author and translator dates come from Gutenberg's own catalogue
(`pg_catalog.csv`), not from memory.

### The trap this guards against

A Gutenberg edition is public domain; **an essay bound into it is not**.
*Winesburg, Ohio* ships with an introduction by Irving Howe, who died in 1993,
and the splitter happily produced it as a boks on the first run. The builder
now refuses any section whose title names it as editorial — introduction,
preface, foreword, notes, appendix and the rest — and any piece credited to
someone other than the author. That list is a copyright control, not
housekeeping.

Gutenberg's own licence header and footer are stripped, so the Project
Gutenberg trademark is not used. The provenance is recorded instead in each
piece's admin-only rights note: `Project Gutenberg #2776 · O. Henry (d. 1910),
published 1906 · public domain in the US (pre-1929) and in life+70 countries`.

---

## How the splitting works

A Gutenberg book is a whole collection. A bok is one piece. The splitter tries
three strategies, in order of how much the book tells you about itself:

1. **Its table of contents.** The real titles, so the boundaries are exact.
   The table's *end* matters as much as its entries: without it the splitter
   slices the table itself into "pieces", which is what happened to Millay and
   looked plausible enough to pass every length check. Tables that list a
   title and its opening line are told apart by indentation — titles sit at
   the shallowest indent.
2. **Standalone headings**, for a book with no table. A heading is a short
   line, alone between blank lines, in capitals or real title case.
3. **Roman numerals**, for sequences the poet numbered rather than named. The
   numerals must start at I and run in order, or a book that merely mentions
   "IV." produces scattered marks whose last "piece" swallows the volume.

### What went wrong, and what each rule is for

Every rule below exists because its absence produced broken literature:

- **A heading must be in title case.** Allowing any line that did not end in a
  full stop split Saki's stories on their dialogue: a hundred "pieces" that
  were one paragraph from the middle of a story, titled with whatever the
  narrator had just said.
- **Speech is never a heading.** A short line of dialogue is in title case as
  often as not — "Strike!", "Mrs. Lamper?" — and taking it for a title tore
  five Saki stories and three of Wharton's into fragments.
- **A title anchor must stand alone.** "beyond the bayou." ends one Chopin
  story and names another; anchoring on the later match truncated the first
  silently.
- **Trailing furniture is trimmed.** A slice runs to the start of the next
  piece, so it ends with that piece's rule, numeral or title.
- **A right-aligned number means an index**, never a line of literature.
- **Poetry is declared, not detected.** Whitman's free verse runs to lines as
  long as a wrapped paragraph, so no measure of the text can tell his line
  breaks from a printer's — and unwrapping him turns the poem into prose.
  `kind: "poetry"` in the source list says so.

### Validation

`--out` is a directory of Markdown files, so the corpus is reviewable before
anything is imported. What was checked on this build:

- every piece starts with a capital and ends with terminal punctuation (verse
  excepted, where it is normal not to);
- no piece contains Gutenberg boilerplate, a copyright page, a table of
  contents or an index page reference;
- no two pieces share an opening;
- titles are titles, not fragments of narration;
- and a hand-read sample: "The Gift of the Magi" ends on *They are the magi.*,
  "The Open Window" on *Romance at short notice was her speciality.*

---

## Loading it

The import runs through the console — **Catalogue → Choose a folder** — which
is the same path documented in `docs/catalogue-import.md`. The ids are stable
(`pg2776-the-gift-of-the-magi`), so a re-run imports nothing, and the whole
batch comes out again with the prefix `pg`.

For a load of this size from a machine that is not the one running the browser,
writing the corpus as one `.jsonl` file and letting the console read it is the
fastest route: 457 pieces import in about twenty seconds.

---

## What this corpus exposed in the product

Loading real content found two defects that demo data could not:

1. **Author spacing had stopped working.** The ranker keyed "same author" on
   the account, and a publisher's catalogue has one account for every piece —
   so the penalty applied equally to all candidates, which is the same as
   applying it to none. The feed served five poems by one poet in a row. The
   key now prefers the byline. Asserted in `for-you.test.ts`.
2. **The reader reflowed poems into paragraphs.** Its verse test required an
   average line of 34 characters, which is the *median* of real verse, so
   Teasdale, Whitman and half of Dickinson were rendered as prose. Line length
   cannot separate a poem from a hard-wrapped paragraph — a Teasdale line and
   prose wrapped at sixty columns are the same width. The right-hand edge can:
   a wrapper fills every line to its margin, a poet does not. Retuned against
   the catalogue and against paragraphs wrapped at five widths.

Still open, and visible: the feed leans heavily on short verse. Every piece now
shares one account and the same default genre and mood, so the byline is the
only diversity dimension the ranker has left, and its streak penalty is a soft
weight rather than a rule. See the queued work in `docs/project-state.md`.
