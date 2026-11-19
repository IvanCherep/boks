# Publishing from My page

Status 2026-11-20: released (see "Production" below).

An author whose page the team opened (the authors behind the red curtain)
publishes a new bok from Cabinet → My page in about a minute. They paste the
text, keep or type a title, give it a cover and press Publish. Nobody reviews
it: the team chose them when it made the page, as it did when it granted Boks
Series. Every other author sends texts for review as before (`/author`, Write
a text / Upload files).

## Who publishes directly

Only **verified authors**: the owner of a published author page the team has
marked verified (`author_spaces.verified`), and not suspended
(`boks_publishes_directly`). These are the authors the team brought onto the
platform: Прохоров, Дарья Мальо-Субботина, Воденников, Демидов, Комаров,
Август and those who come after them.
- The migration marks as verified: pages the team made (their creator is not
  their owner), pages on the Series shelf, and the pages of authors granted
  Boks Series.
- A page the team makes from now on is verified as it is made (trigger
  `author_spaces_verified_by_team`).
- Studio → Authors → a page → **Verified author** switches it either way
  (`studio_set_space_verified`).

An ordinary author can also have an `author_spaces` row: the database makes
one, public, the first time they order their works (`save_author_space_order`).
That page is **not** verified. They keep sending texts for review, see no New
bok on My page, and the composer's address shows them the way to review
instead. Drawing, publishing straight away and asking the team for a cover
are all refused by the database for them, not only hidden.

## The composer

`components/boks/author-cabinet/composer.tsx`, view `#my-page-new`:

- **Text**: one field that grows with the text. Line breaks are kept as typed.
  It shows the length and the reading minutes, and warns past the 15-minute
  limit (`boks_max_text_characters()`).
- **Title**: optional. When the pasted text starts with a short line on its
  own, the composer asks whether that is the title, and moves it out of the
  text if the author says yes (`headingLine`). While it is empty the field shows the title the piece
  will get, which is `boks_title_from_text` mirrored by `lib/boks/bok-title.ts`
  (a `* * *` line is skipped).
- **Cover**: required to publish, not to save a draft. Drawn, uploaded, or left to the editors (below):
  - **Draw two**: two pictures in the house look, drawn from the text. That
    is the whole allowance for one piece. The first goes on the cover at
    once; the author can switch to the other.
  - **Upload your own**: any picture, or drag it onto the frame. The browser
    cuts it to 9:16 around the middle at 1080×1920
    (`lib/boks/author/covers/cover-image.ts`).
  The frame shows the cover with the title over it, as the reader's cover does.
- **The Boks Series note**: the best works, chosen by the editors and readers,
  get their own Boks Series episode.
- **Publish** (⌘/Ctrl Enter) or **Save as draft**. The rights line under the
  buttons is the confirmation, with a link to `/terms#author-content`: there is
  no checkbox. Until the piece is saved, the text waits in this browser's
  storage, so a closed tab loses nothing.
- **After publishing**: the cover, links to the bok and to My page, and a
  note that the moving preview for links is made in the background, usually
  within half an hour. That is the curtain loop job
  (`deploy/curtain/curtain.mjs`): every 15 minutes, at most 8 loops a run.

## The editors' cover

Under the cover buttons: **Let the editors choose the cover**. The frame then
says so, and Publish becomes **Send to the editors**. The piece goes to the
ordinary review queue (`pending_review`, `reels.cover_requested`). The author
is told it goes out as soon as the editors choose its cover. It waits on My
page marked **Waiting for a cover**; the author can still edit it there. If
they add their own picture, it goes out at once.

In Studio → Moderation, the piece is marked **Needs a cover** and shows a
panel (`components/boks/admin/team-cover.tsx`). Studio uploads a picture
(`studio_set_bok_cover`) or draws two with the same pipeline (admins are not
counted against an author's allowance) and picks one. Approve is refused
until there is a cover: by the panel, and by the database for every path
(trigger `reels_cover_before_publish`). So every bok goes out with a picture.

## Requests and ideas

The page's conversation with the team is no longer a section of My page. It
sits behind one button, **Requests and ideas**, which carries the unread count
and opens a sheet:
- a kind: **Something doesn't work**, **An idea** or **A question**;
- the note, sent through `send_my_author_space_message` with the kind as a
  prefix (`Idea: …`);
- the conversation so far, newest first.
The team answers from Studio → Authors, as before. A reply also shows the
"The team has replied" strip, which opens the sheet.

## On My page

For an author who publishes directly, My page is the cabinet's home: opening
`/author` goes straight there, and the cabinet's own **New bok** opens the
composer, not the review form. On a phone, the page's buttons sit in one
compact row, so New bok is on the first screen.

A **New bok** button sits above the works. A draft is a row of its own with
the Draft chip and **Continue**. It is not in the order view, because readers
do not see it. A published piece the author wrote here, with no Series and no
prepared work behind it, gets **Edit**, which opens it in the composer and
saves it without a review. **Hide from the site** and **Put back** work as for
every bok. A new piece goes first on a page the author has ordered by hand, when it is
written or when a draft is first published.
A page never ordered shows newest first anyway.

## Data

Migration `20261120100000_boks_author_direct_publishing.sql`:

| | |
|---|---|
| `bok_covers` | one picture per bok. `webp` is for the reader (a JPEG when the browser writes no WebP, as Safari does); `jpeg` is for link cards and the curtain loop. Also `source` (`upload` or `generated`) and `version`. Read and written only through RPCs |
| `reels.cover_version` | whether a bok has its own picture, and which one. Carried by `boks_reels`, `published_boks`, `get_recommendation_candidates` and `get_boks_author` |
| `bok_cover_drawings` | every drawing asked for. At most 2 pictures per piece and 12 a day per author (`boks_cover_pictures_per_piece`, `_per_day`) |
| `save_my_bok` | text, title, cover and state in one call: `draft` or `published`, and a hidden piece stays hidden. Publishing needs a cover. The composer chooses the bok id, so drawings count from the first press |
| `get_my_publishing`, `get_my_bok_draft`, `delete_my_draft`, `reserve_my_cover_drawing`, `get_boks_cover` | what the composer asks; the picture of a published bok |
| `reels.cover_requested`, `studio_cover_requests`, `studio_bok_cover`, `studio_set_bok_cover`, trigger `reels_cover_before_publish` | the editors' cover |

Where a bok's picture comes from, in order:
1. a registered Series cover;
2. the catalogue artwork;
3. its own picture, `/b/<id>/cover.webp?v=<version>` (`lib/boks/own-cover.ts`).

The link card and the curtain loop use `/b/<id>/cover.jpg`. The version is in
the card's key, so a new picture also remakes the loop.

## Drawing

`POST /api/author/covers` with the author's token. The database counts the
pictures first (`reserve_my_cover_drawing`). Then the route writes a job under
`BOKS_COVERS_DIR`. `scripts/cover-worker.mts` (`npm run covers:worker`) picks
it up:
- YandexGPT writes two scenes from the piece's opening (at most 1 500
  characters, whole lines);
- Alice AI Image draws them in the Series recorder's house look. It uses
  `artPrompt`, `drawPicture` and `readScenes` from
  `lib/boks/series-recorder/art.ts`; the cover prompt is
  `lib/boks/author/covers/cover-art.ts`.

The composer polls `GET /api/author/covers/<job>` and shows
`/<job>/picture-<n>.jpg`. A job id is 128 random bits, known only to the
author who asked. The worker clears jobs after a day.

Cost: about 2.23 ₽ a picture (`docs/series-recorder.md`), so at most about
4.5 ₽ a piece and about 27 ₽ a day per author. A failed drawing still counts
against the allowance; the worker logs `ALERT` lines for the team's Telegram.

Locally, without keys: `BOKS_COVERS_FAKE=1 npm run covers:worker` draws two
gradients, so the whole flow can be tried. The dev server must run with
`BOKS_PLATFORM=node`, as for the Series recorder.

## Production

The covers worker runs inside the Series worker's process
(`scripts/series-worker.mts` calls `runCoverWorker`): the `series` service
already has the Yandex keys and a restart on every release. Jobs live in
`series-drafts/covers/<job>`, the folder the app copies and the Series worker
already share; a cover job sits one level below a Series draft, so neither
queue reads the other's. Nothing in `compose.yml` changed.

Still open: whether the team's Telegram should hear about each direct
publication, as it does about works sent for review (`deploy/ops/inbox.py`).
