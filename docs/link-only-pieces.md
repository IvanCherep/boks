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
`[a-z0-9-]+.(json|mp3|webp)`, so a request cannot walk out of its folder.

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
5. Upload the folder to production:

   ```bash
   for f in <folder>/*; do
     npx supabase storage cp "$f" "ss:///link-only/<token>/$(basename "$f")" --linked --experimental
   done
   ```

6. Open `https://tryboks.com/l/<token>` on a phone and play it through.

Keep the link and the scratch folder outside git. To take a piece down,
delete its folder (`npx supabase storage rm -r ss:///link-only/<token> --linked
--experimental`); the page then says there is nothing at the link. Cached
copies expire within ten minutes.

## Pieces

Recorded here by title only, never with the token.

| Piece | Author | Since | Format |
|---|---|---|---|
| «там где скрипели качели» | Алексей Прохоров | 2026-11-04 | immersive poem, Alex Bell, 5 pictures; rub away the haze in the third, hold the heart in the last |
