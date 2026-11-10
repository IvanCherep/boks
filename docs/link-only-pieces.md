# Link-only pieces

A **link-only piece** is a living author's work produced in a boks format and
shown only to whoever holds its link: a demonstration for an author we would
like to have on boks, before there is any agreement to publish. It is not a
bok. It is not in the catalogue, so the feed, the series shelf, search, author
pages, the studies and the algorithm comparison never see it.

## Why its files are not in this repository

`IvanCherep/boks` is public. A poem's `lines.json`, its manifest, its
recording or its pictures committed here would publish the work to anyone
who browses GitHub, and its token with it, which is exactly what the author
has not agreed to. So the repository holds only the mechanism:

| Path | What it is |
|---|---|
| `app/l/[token]/page.tsx` | the page: noindex, title and cover for a messenger's preview |
| `app/l/[token]/f/[file]/route.ts` | the piece's files, read from storage and served same-origin |
| `components/boks/link-only/link-only-poem.tsx` | the ordinary immersive player, with no bok behind it |
| `lib/boks/link-only.ts` | the token and file-name rules, and the two addresses |
| `supabase/migrations/20261104120000_boks_link_only_bucket.sql` | the `link-only` bucket |

There is no list of pieces anywhere in code. The token is the folder name in
storage, so a piece exists when its folder does.

The bucket is public: an object is served to anyone who asks for its exact
path, and nobody can list the bucket, because `storage.objects` has no row
policy for `anon` or `authenticated`. A token is 22 characters of base64url,
128 random bits; the route refuses anything shorter and any file name outside
`[a-z0-9-]+.(json|mp3|webp|jpg|gif|mp4)`, so a request cannot walk out of its folder.

Same-origin rather than straight from storage because the scene gestures draw
the picture into WebGL, which refuses a cross-origin image without CORS, and
because the content-security policy then needs no storage host.

## What the reader gets

The immersive poem exactly as the series plays it: cover, voice, theme,
pictures, gestures. Its ending has the aftertaste tags and Again, and no like,
comment, share or next: those need a bok. Close goes to the feed. Nothing is
written to `recommendation_events` or the served feed.

## Making one

Produce the poem as `docs/reading-formats.md` §4 describes (voice, loudness,
theme, theme gain, scene map, manifest), with every input in a scratch folder
outside the repository. Then:

1. A token: `python3 -c "import secrets; print(secrets.token_urlsafe(16))"`.
2. In the built manifest, point `audio`, `theme.src` and every scene `image`
   at `/l/<token>/f/<file>`, flat (no `scenes/` folder). If a pause was added
   after the last line, set `durationMs` and the last line's `endMs` to the
   recording's length.
3. A `cover.webp`, 720 px wide, from one of the frames.
4. A new scene-gesture hint needs its translation in
   `components/boks/poetry/gesture-hints.ts`; the hint test only reads
   `public/poetry/`, so it will not catch this one.
5. Upload the folder to production (the server's link-only folder, which
   only the app can read; `docs/agents/production-changes.md`):

   ```bash
   rsync -a <folder>/ boks-app:/opt/boks/link-only/<token>/
   ```

6. Open `https://tryboks.com/l/<token>` on a phone and play it through.

Keep the link and the scratch folder outside git. To take a piece down,
delete its folder (`ssh boks-app 'rm -r /opt/boks/link-only/<token>'`); the
page then says there is nothing at the link. Cached
copies expire within ten minutes.

## Published author-held pieces

When a living author agrees to publish, the piece becomes an ordinary bok -
in the catalogue, the feed and the series shelf - but its files still stay
out of this public repository: permission to publish on boks is not
permission to put the text and the recording on GitHub. The same bucket and
the same route serve them, so a published author-held poem is a link-only
folder whose manifest a bok points at:

1. Make the folder exactly as above, with a fresh token.
2. Insert the bok and its `bok_rights` row (the note names the author's
   permission and the date) with a fixed id, from a scratch SQL file: the
   text is the author's too, so the SQL does not go in the repository.
3. Register `"<bok id>": "/l/<token>/f/manifest.json"` in
   `components/boks/poetry/poems.ts`, and the shelf entry with its cover in
   `components/boks/series/series-catalogue.ts`. The cover is a frame of our
   own illustration and lives in `public/series/` as usual. The shelf test
   cannot read a manifest in storage, so it checks only the address; check the
   duration and scene count against the manifest when the folder is made.

An author who reads the piece himself brings his own recording, usually
mastered with music under it. Then there is no theme (`theme` is left out of
the manifest), the recording is only brought down to the series' −22 LUFS by
gain, and the word times come from ElevenLabs forced alignment
(`/v1/forced-alignment`, the recording plus the exact text) checked against
speech-to-text word times: forced alignment glues a short word that opens a
line after a pause («в», «и») to the end of the phrase before it, and those
take the speech-to-text start instead. Nothing is generated.

Published this way:

| Piece | Author | Since | Format |
|---|---|---|---|
| «коса», «у горы Мегиддо», «азбука веры», «из возвращения в побег», «память шва», «розы Сарагосы» | Алексей Прохоров | 2026-11-08 | immersive poems in the author's own recordings, 3 pictures each (5 for «розы Сарагосы»); their own section on the series shelf; published by the account @prokhorov, which the team holds until the author takes it (`deploy/author-account.sh`) |
| «полет сквозь сны» | Алексей Прохоров | 2026-11-10 | immersive poem in the author's own recording, 5 pictures; first in his section; published straight from @prokhorov |
| «сошлись по швам», «наконец-то родился я» | Алексей Прохоров | 2026-11-10 | immersive poems in the author's own recordings, 3 and 7 pictures; «сошлись по швам» first in his section, «наконец-то родился я» before the long roses; published straight from @prokhorov |

### A poet's own address

A poet with a section gets an address of their own to share, `/series/<slug>`
(`app/series/[section]/page.tsx`, registered with its pitch in
`components/boks/series/series-sections.ts`): the shelf opened on their section, which
comes first and in every language whatever the reader's shelf filter. A
messenger previews it as their book's cover. Both pictures are the author's,
so they live in a link-only folder of their own, not in `public/`:

- `<book>.webp`, 480 px wide, shown beside the section's name (`book` on the
  collection in `series-catalogue.ts`);
- `<book>-share.jpg`, 1200x630, the link preview: the whole cover in the middle
  on a blurred copy of itself, because messengers crop a portrait image and
  not all of them take WebP. JPEG is allowed in a link-only folder for this,
  and a `-share.jpg` is the one file served without `X-Robots-Tag` (also
  `-share.gif`, `-share.webp` and `-share.mp4`, the animated cards of the
  preview lab, `lib/boks/preview-lab.ts`).

Telegram caches a preview per address: a link sent while it was still a 404
keeps an empty card until it is sent to `@WebpageBot`.

| Address | Author | Since | Preview |
|---|---|---|---|
| `/@prokhorov` | Алексей Прохоров | 2026-11-09 | his portrait page (design v48, `components/boks/author-portraits.ts`): `prokhorov-portrait.webp`, `prokhorov.webp` and the 1200x630 card `prokhorov-share.jpg`, all in the same folder as the «Верослов» cover |
| `/veroslov` (also `/series/veroslov`, `/series/prokhorov`) | Алексей Прохоров | 2026-11-09 | an alias of his author page, previewed as the book (`veroslov-book-share.jpg`, 1024x1024, `aliases` in `author-portraits.ts`); until 2026-11-09 `/series/veroslov` opened the shelf: |
| `/p/<slug>` (preview lab, temporary) | Алексей Прохоров | 2026-11-09 | his author page or one of his boks under forty-three hidden addresses, each with a different card (`lab-*-share.*` in his folder): bookmarks, squares, a 4:5 poster, GIF, animated WebP, `og:video`. Listed in Studio → Links; delete when a format is chosen |
| (was) `/series/veroslov` | Алексей Прохоров | 2026-11-08 | the cover of «Верослов», named after the book at the poet's wish |

## Pieces

Recorded here by title only, never with the token.

| Piece | Author | Since | Format |
|---|---|---|---|
| «там где скрипели качели» | Алексей Прохоров | 2026-11-04 | immersive poem, Alex Bell, 5 pictures; rub away the haze in the third, hold the heart in the last |
