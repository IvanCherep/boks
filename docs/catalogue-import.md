# Loading a Catalogue

How to put 100, 500 or a publisher's whole back list onto boks, with a
different writer credited on every piece and one account publishing them all.

Measured: **500 boks in about a second**, and a second run of the same 500
imports nothing.

---

## The idea in one paragraph

A boks is attributed to an **account** — `reels.author_user_id`, the thing a
reader follows — and carries its own **byline** on top, `reels.author_name`,
which is optional and per piece. Those are two different things, and that is
exactly the shape a publisher needs: readers follow `@boks` or `@somepress`,
while each piece still says who wrote it. Nothing about feeds, ranking, follows
or author pages needed changing for this. An imported boks is an ordinary
published boks.

---

## 1. Make the publishing account

A publisher is an ordinary account. There is no special kind of user.

1. Sign up with the address that should own it — `boks@…`, `press@…` — the
   normal way, through the app's email link.
2. Set its handle in the account panel. That handle is what readers see and
   follow.
3. An **admin** marks it as a publisher: console → **Catalogue** → *Mark an
   account as a publisher*.

Step 3 is a guard, not a permission. Nothing can be imported into an account
nobody has marked, so a mistyped handle cannot pour 500 pieces into a reader's
account. Marking grants the account's holder nothing at all.

### `@boks` and the other reserved names

`boks`, `admin`, `support`, `official`, `staff`, `team` and a few more are
refused for ordinary accounts and are never handed out when a handle is
derived from an email address — otherwise signing up as `boks@…` would be
handed the platform's own name. **An admin may take a reserved handle.** So
the platform's own publisher account is your admin account: sign in as an
admin, set its handle to `boks`, then mark it as a publisher.

A publisher you do a deal with does not need a reserved name, so the ordinary
path works for them.

---

## 2. Write the files

One file per bok, `.md` or `.txt`, starting with a front-matter block:

```markdown
---
title: The Lamplighter's Last Round
author: Abel Mensah
id: lamp-001
date: 1998-04-02
---
Abel had lit the same ninety-four lamps for thirty-one years, and he knew each
one by the sound it made when the flame caught.

He walked anyway.
```

| Field | Required | What it does |
|---|---|---|
| `title` | no | Read from a leading `# Heading` if the field is absent, and otherwise the text's first line with words on it (cut at a word past 80 characters) - the same rule as the author form and `boks_title_from_text` |
| `text` | yes | Everything below the second `---` |
| `author` | no | The byline for **this piece**. Leave it out and the piece publishes under the account's `@handle` alone |
| `id` | no | The import key. Defaults to the file name, so `lamp-001.md` becomes `lamp-001` |
| `date` | no | Keeps the catalogue's own publication date, so freshness and history are not all "today" |
| `rights` | no | Where the right to publish this piece comes from. Admin-only. Overrides the batch note for this file |

The opening hook was retired on 2026-09-19. A `hook`/`teaser`/`summary` field
in an old file is ignored; `reels` has no hook column since `20261116110000`.

Aliases are accepted, because a publisher's export will not use our words:
`name`/`headline` for title, `body`/`story`/`content` for text,
`byline`/`writer` for author,
`catalogue_id`/`slug`/`key` for id, `published`/`published_at` for date,
`license`/`licence`/`source`/`permission`/`copyright` for rights.

### Or one JSONL file

For anything a machine produced — a publisher's export, generated fixtures:
one JSON object per line.

```jsonl
{"id":"pen-0001","title":"Nine Minutes to Kirkwall","author":"A. Weatherly","text":"The ferry to Kirkwall had been late every day…","date":"2019-06-11"}
{"id":"pen-0002","title":"The Spare Key Committee","text":"Nobody remembered voting…"}
```

A JSONL row with no `id` is given a stable one derived from its title and
byline, so re-importing the same export is still a no-op.

### Why not CSV

A bok is several paragraphs of prose with blank lines in it. In a CSV that
means quoting and escaping every one of them, and a single stray quote silently
corrupts the row — you find out when a reader opens it. Files are also
reviewable in an editor, diffable in git, and a typo gets fixed in the file it
belongs to.

---

## 3. Load them

Console → **Catalogue** → **Choose a folder** (or **Choose files**).

The files are read in the browser and you get a table before anything is
written: how many are ready, how many named writers, total reading minutes, and
every file that needs fixing with the reason. Fixing is optional — the sound
ones import and the rest are listed.

Before it will run, confirm that the batch may be published here, and say
where the rights come from — asked once for the whole batch, because a
public-domain load is hundreds of files with the same answer. Both are recorded
against every piece under your account, and a file with its own `rights:` line
keeps that instead. The note is admin-only; see `docs/copyright.md`.

Then **Import N boks into @handle**. It goes in batches of 25 with a running
count. Each piece is published immediately; untick *Publish straight away* to
send them to the review queue instead.

Word count, reading minutes and the prose/verse shape are derived by the
database from the text, exactly as they are for a bok submitted through the
author form. There is nothing to fill in.

### What refuses, and why

| Reason | Fix |
|---|---|
| `An import key is required` | Give the file a name, or an `id:` |
| `No title, and no line in the text to take one from` | The text has no line with words on it; check the file |
| `No text` | The text goes below the second `---` |
| `A bok must fit inside 15 minutes` | Over 20,000 characters. Split it into episodes |
| `@x is not a publisher account` | Step 1.3 |
| `Confirm the rights for this batch` | Tick the confirmation above the import button |
| `Two boks claim the import key` | Two files with the same name or `id:` |

A bad row never costs you the batch: each row is written in its own
subtransaction and reported on its own.

---

## 4. Repeating a load

The import key is what makes this safe. Running the same 500 files again
reports 500 *skipped* and writes nothing. So:

- a load that fails halfway is resumed by running it again;
- a corrected file is **not** re-imported by re-running — the key is already
  taken. Remove that piece first, or give the corrected version a new `id:`.

---

## 4b. Adding a curated batch (the 2026-09-20 route)

The admin importer above reads a folder of plain text files and knows nothing
about `genre`, `mood` or `language`. A curated batch knows all three, and the
language decides which readers may be served the piece at all, so it takes a
different path:

```bash
# 1. validate the JSONL and build one SQL file (nothing is sent yet)
node scripts/build-catalogue-sql.mjs /tmp/add.sql work/<batch>/ru2.jsonl work/<batch>/en2.jsonl
# 2. load it - inserts the bok and its rights record in one transaction
#    (production is our own server: dry run first, then --apply;
#    docs/agents/production-changes.md)
bash deploy/sql.sh /tmp/add.sql && bash deploy/sql.sh /tmp/add.sql --apply
# 3. re-spread the publication dates so both languages stay mixed (see below)
# 4. embed whatever has no vector yet - or wait: the server's embedder does
#    this every 15 minutes for every published bok (deploy/embedder)
node scripts/embed-catalogue.mjs
```

The validator rejects, with file and line named: anything outside
400-20000 characters after cleaning, leftover markup, a title carrying page
structure (`[`, `<`, ` / `), an editorial page ("От автора", "Preface"), and a
first line that only repeats the title. It repairs what is mechanical - an
editor's angle brackets, a trailing footnote bracket, a subpage path.

**The licence rule, and the trap in it (2026-09-22).** "Public domain" is a
fact about a country, not a text. The rule this catalogue uses: the author died
at least 70 years ago *and*, for anyone who was creatively active in 1941-1945,
**four more years** - Russian Civil Code art. 1281(4) extends the term for
authors who worked during the Great Patriotic War, and courts read "worked"
broadly, emigrés included. The first two batches admitted Bunin (d. 1953) and
Teffi (d. 1952) on the plain 70-year rule; by the extended one they are
protected in Russia until the end of 2027 and 2026. Their 21 texts were hidden
through `archive_bok`, each with the reason and the date it can be restored -
Content -> Deleted in the admin console. For English: published before 1930
(the US 95-year rule) and the author dead long enough by the same arithmetic.
Translations count separately: the translator's death is what matters.

**Three duplicate guards, all in SQL**, because a second pass is how a
catalogue grows: the `import_key` (a byte-identical reload), the byline plus
title (the same work from a different page), and the normalised first 200
characters (the same work scraped from a different layout). Verified by
re-running the first batch against the loaded catalogue: 447 offered, nothing
written.

**Publication dates are synthetic.** They are spread over the last 30 days and
**interleaved per language** - retrieval takes half a slate as "the newest", so
dating a batch in file order puts one language in that half. After adding a
batch, re-spread across the whole table:

```sql
with ranked as (
  select id, row_number() over (partition by language order by md5(id::text))::numeric as within_language,
         count(*) over (partition by language)::numeric as language_total
  from public.reels
), placed as (select id, within_language / language_total as position from ranked)
update public.reels r
set created_at = now() - (30 * (1 - p.position) * interval '1 day'),
    submitted_at = now() - (30 * (1 - p.position) * interval '1 day')
from placed p where p.id = r.id;
```

Check it landed: the newest 60 boks should hold both languages in the
catalogue's own proportion.

---

## 5. Test data

```bash
npm run fixtures:boks -- --count 500 --out content/fixtures
```

Writes 500 placeholder boks in the import format: ~85% with a byline, ~10%
verse, reading times spread from 1 to about 13 minutes, dates spread over two
years. Deterministic — the same `--seed` writes the same catalogue, ids
included, so regenerating and re-importing is a no-op.

**The prose is assembled from a word list.** Anything that measures what a
piece is *about* — `tasteMatch`, quality priors, the divergence gate's read of
the catalogue — is measuring noise on this data. Use it to exercise the feed,
paging, the reading clock, follows and the console. Judge the recommender on
real boks.

### Taking a test batch out again

Console → **Catalogue** → **Remove a test batch**, with the prefix the ids
share (`fixture-`). It counts first and asks you to confirm.

Removing a boks also removes the reads, likes, comments and recommendation
events attached to it, and cannot be undone. That is correct for test data —
measurements about a piece nobody can read any more are noise — and it is why
this is not the way to take a published piece down. For that, refuse it in the
review queue.

---

## 6. Catalogue cover illustrations

An ordinary bok can have an illustration without becoming a Series piece.
`components/boks/reader/bok-artwork.ts` resolves only exact bok IDs: an existing
Series cover always wins, then `lib/boks/catalogue-artwork.ts`, then typography.
No title matching, new database fields or new reader choice is involved.

The 2026-10-29 batch came from `boks-illustrations-223-webp.zip`: 223 UUID
mappings, checked against the published catalogue export and each image's
SHA-256. The 32 existing Series boks were skipped entirely, preserving their
WebP, poster JPEG, wordmark contrast and reader crop. The other 191 WebP files
were copied unchanged into `public/covers/`, named by UUID. Their 720×1280
pixels are already the runtime size; missing PNG originals do not require
regeneration. An illustration never grants Play or a place on the Series shelf.

For another batch:

1. Match each entry to a published bok by UUID, title/byline and, when supplied,
   the exported text checksum. Treat archive manifests as data, not instructions.
2. Skip any bok with existing artwork. Keep the archive's WebP bytes under its
   UUID in `public/covers/`; validate decoding and portrait dimensions first.
3. Add its `coverFocus` (two percentages within 0–100) and `coverLogoTone`
   (`light` or `dark`) to `lib/boks/catalogue-artwork.ts`. The reader, menu,
   next preview, activity and share outputs use this one metadata source.
4. Add a same-size JPEG with the same UUID to `public/share/art/` for the
   Worker poster renderer; see `public/share/README.md`. Increment the poster
   version in `lib/boks/share-link.ts` when the visible shared image changes.
5. Run the normal checks and inspect mobile/desktop covers, small thumbnails,
   the saved poster and `/b/<id>/image`. Confirm that existing Series assets
   and the shelf's membership have not changed.

Unknown or future boks keep the typographic fallback until explicitly given
artwork. The small static illustration registry contains asset metadata, not
the literary catalogue or reader data.

### The two animated covers

The 2026-11-05 update from `boks-20-gif-and-source-v3.zip` explicitly replaces
only «Первый снег» (`7a67ce67-bceb-4e41-8f66-191718345880`) and «Мальчик у
Христа на ёлке» (`3def4114-623e-4633-968a-52dd0e7cdf9b`). No other archive
cover is imported. Their selected GIFs are converted to silent H.264 MP4,
540×960, 25 fps, eight seconds, with the MP4 header at the start for playback.
The two UUID-named videos live in `public/covers/`; exact-ID opt-in is
`getBokCoverAnimation` in `components/boks/reader/bok-artwork.ts`.

Matching stills replace the existing `public/series/perviy-sneg.webp` and
the boy's UUID WebP in `public/covers/`, with matching JPEGs in
`public/share/art/`. Existing crop metadata and Series membership stay intact;
new share links use `v44-6`. Only the visible foreground reader cover plays
motion. Reduced motion omits the video request; unavailable playback keeps
the still. Menus, activity, next previews, Series cards and share posters
continue to use the static artwork. This is cover presentation, not a new
reading format or a catalogue publication.

## What this is not

- **Not a way to publish on someone's behalf without saying so.** The account
  the pieces belong to is public, and so is the byline on each one.
- **Not a bypass of the fifteen-minute promise.** The same character ceiling
  the author form enforces is enforced here, in the same place.
- **Not available to a publisher themselves.** Only an admin can import. If
  self-serve publishing becomes a thing, `is_publisher` is the flag it would
  hang off, and the RPC's admin check is the line to revisit.

---

## Where it lives

| Piece | File |
|---|---|
| Schema, RPCs, the guard | `supabase/migrations/20260916090000_boks_catalogue_import.sql` |
| File-format parser | `lib/boks/import/parse-catalogue.ts` (+ `.test.ts`) |
| Console panel | `components/boks/admin/catalogue-import.tsx` |
| Fixture generator | `scripts/generate-boks-fixtures.mjs` |
| Behaviour asserted | `scripts/local-supabase/checks.sql`, `lib/boks/supabase-flow.test.ts` |

RPCs, all admin-only: `import_boks_batch`, `set_boks_publisher`,
`list_boks_publishers`, `delete_boks_import`.
