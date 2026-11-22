# Publishing from My page

Status 2026-11-20: released (see "Production" below).

An author whose page the team opened (the authors behind the red curtain)
publishes a new bok from Cabinet → My page in about a minute. They paste the
text, keep or type a title, read it aloud (see "The author's voice") and press
**Send to the editors**. Covers of text
boks are made only by the editors (owner's rule, 2026-11-21): a new piece goes
to them for its cover and comes out once it has one. A piece that already has
its cover is edited and saved straight away. Every other author sends texts for review as before (`/author`, Write
a text / Upload files).

## Who publishes directly

Since 2026-11-22 (`20261122180000_boks_author_before_page_opens.sql`) the page
need not be open to readers: owning a verified author page in any state but
merged (`draft`, accepted but not opened; `published`; `unpublished`) is
enough. An invited author can write, record and send before opening the page,
and a team test account can use the cabinet without appearing to readers.

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

## The old way in is closed (2026-11-22)

«Мои тексты» → «Написать текст» / «Загрузить файлы» used to put a text into
review with no voice (`submit_bok_for_review`). Every author today is one the
team invited, and no bok goes out without its author's voice, so that way is
closed: the cabinet's New sheet explains how publishing works (with a line for
an admin account, which has no My page of its own), the old screens send back
to the library, and a trigger on `reels` refuses a move into review unless it
is the voiced way (`cover_requested`), the caller is Studio, or there is no
caller (imports, server jobs)
(`20261122160000_boks_review_needs_voice.sql`).

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
- **Cover**: the editors'. The author cannot upload or draw one. The frame
  says «Обложку делает редакция» until there is a cover, then shows it with
  the title over it, as the reader's cover does; to change it the author
  writes to the editors in Requests and ideas. The database refuses a cover
  from an author (`save_my_bok`) and refuses them a drawing
  (`reserve_my_cover_drawing`), `20261122100000_boks_covers_by_editors.sql`.
- **Voice**: under the text, the author's reading of it. A new piece goes to
  the editors only with one; see "The author's voice".
- **The Boks Series note**: the best works, chosen by the editors and readers,
  get their own Boks Series episode.
- **Send to the editors** (⌘/Ctrl Enter) or **Save as draft**; for a piece
  that already has its cover, **Publish** or **Save changes**. The rights line under the
  buttons is the confirmation, with a link to `/terms#author-content`: there is
  no checkbox. Until the piece is saved, the text waits in this browser's
  storage, so a closed tab loses nothing.
- **After publishing**: the cover, links to the bok and to My page, and a
  note that the moving preview for links is made in the background, usually
  within half an hour. That is the curtain loop job
  (`deploy/curtain/curtain.mjs`): every 15 minutes, at most 8 loops a run.

## The author's voice

The author's voice is the platform's DNA (owner, 2026-11-22): no bok goes out
without its author's reading. The composer's **Голос** block, between the
text and the buttons, says so in one line («Каждый бок выходит с вашим
голосом. Рисунки и серию делает редакция, от вас нужен только голос.») and offers two equal
ways, side by side (stacked on a phone):

- **Записать с суфлёром**: the Series recorder's teleprompter and microphone
  (`components/boks/admin/series-recorder/teleprompter.tsx`, `microphone.ts`):
  level check, a 3-2-1 count, pace, hold, start over (R), Space to stop. Prose
  is cut into lines for it by `promptStanzas`: a blank line starts a stanza, a
  line break is a line, a long line is cut after sentences, then commas, then
  between words, at about 64 characters.
- **Загрузить готовую запись**: mp3, m4a, wav, ogg or webm, up to 15 minutes
  and 25 MB. The file input is reset after each pick, so the same file can be
  chosen again.

Takes are listed newest first: listen, choose, delete (at most 5 at a time,
30 in all). A new take is chosen when none is, or when the chosen one reads
another text. Each take remembers the text it reads (`voiceFingerprint`: the
first 16 hex digits of SHA-256 of the text with runs of spaces and line breaks
made one space). When the words change, every older take is marked **старый
текст** and does not count until a new one is made; a change of line breaks
alone keeps it. **Send to the editors** stays closed, with the reason under it
(record or attach a reading, no bok goes out without a voice), until there is
a chosen take of the text as it is. **Save as draft** always works; a draft
without a voice shows on My page as **Ждёт вашего голоса** with **Записать**,
which opens the composer at the Голос block. A piece already with the editors
needs a new take only when its words change. Editing a published piece needs
no voice and shows no Голос block.

**Where it is kept.** The takes are files beside the Series recorder's drafts:
`<BOKS_SERIES_DIR>/voices/<bokId>/` (`voice.json` and `take-<n>.<ext>`),
through `app/api/author/voice/<bok>` (GET the takes, PATCH `{ chosen }`) and
`app/api/author/voice/<bok>/<file>` (PUT `take`, GET, DELETE), store
`lib/boks/author/voice/store.ts`. The bytes must be the audio their kind says
(the recorder's `looksLikeAudio`). Who asks is answered by the database with
the caller's own token (`get_my_bok_voice_access`): only the piece's author
(a verified author, the piece theirs or nobody's yet) writes; Studio may also
listen. After every change the route puts the chosen take into the database
(`set_my_bok_voice`, table `bok_voices`), which is all the database keeps.

**What the database refuses** (`20261122120000_boks_author_voice.sql`):
`save_my_bok` sending a new piece to the editors (`p_cover_by_team`), or
changing the words of a piece already with them, without a chosen take of
that very text («Record or attach your reading first: a bok goes out with the
author's voice.»). `boks_voice_fingerprint` in SQL and `voiceFingerprint` in
`lib/boks/author/voice/rules.ts` give the same value; a test holds them to one
known text. The fingerprint comes from the browser, so an author could claim
a take of another text; it is their own piece, and the editors listen to it.

**Studio.** In Moderation a piece shows **Голос автора** next to the cover
panel: the source (teleprompter or own recording, with its file name), the
length, whether it reads the text as it is, a player and a download link
(`components/boks/admin/author-voice.tsx`, `studio_bok_voice`). The editors
build the Boks Series from it.

## When the editors cannot take a piece

A piece sent from My page (text and voice, waiting for its cover) either goes
out, or comes back with the editors' reasons (owner, 2026-11-22). Never a
silent drop, and never an email or a message: the author reads it on My page.

**In Studio → Moderation** such a piece has, beside **Approve**, two actions:
**Вернуть на доработку** and **Отказать**. Each opens a dialog that needs
what the reason is about (**Запись**, **Текст**, **Законодательство**,
**Другое**) and words the author will read
(`components/boks/admin/editor-decision.tsx`, `studio_decide_bok`). Other
pieces in the queue keep the old **Send back with note**.

- **Вернуть на доработку**: the piece goes back to the author as a draft,
  not counted anywhere. On My page it says **Редакция просит доработать**,
  with the reason and the editors' words, and one action: **Записать заново**
  (the composer at the Голос block) for the recording, **Исправить текст**
  for the text, **Доработать** otherwise. The composer shows the same note at
  the top. Returned for the recording, only a reading made after the note
  counts: older takes say «Записана до просьбы редакции», and the database
  refuses to send it again without a newer one. Sending it again answers the
  request (the decision is cleared).
- **Отказать**: the piece is `rejected`. My page shows **Редакция не сможет
  выпустить этот текст**, the reason, the words, that the text stays with the
  author, and a link to Requests and ideas («Если не согласны, напишите нам
  в …»). The text opens in the composer to read, with no send bar; the
  database refuses saving or sending it. In the queue's Refused list Studio
  sees the decision and **Открыть заново**, which turns it into a request for
  changes with the same words (`studio_reopen_bok`).

The disagree line names the button as it reads on My page, «Просьбы и
предложения» («Requests and ideas» in English).

Data: `bok_editor_decisions` (one row a piece: `changes` or `refused`, the
kind, the note, who and when), read by the author through
`get_my_editor_decisions` and by Studio through `studio_bok_decision`,
`20261122140000_boks_editor_decisions.sql`.

## From a voiced piece to its Boks Series (2026-11-22)

A piece sent from My page goes out only with its Boks Series, made by the
editors from the author's reading and published by the author. Migration
`20261122200000_boks_author_series_flow.sql`.

| Step | Author (My page) | Editors (Studio) |
|---|---|---|
| Sent | **Отправлено**: can still change it, or **Отозвать** (a sheet: «Отозвать из редакции? Текст и запись останутся у вас.»). It goes back to drafts with its text and voice (`withdraw_my_sent_bok`) | Moderation: **Принять в работу**, **Вернуть на доработку**, **Отказать**. No **Одобрить и опубликовать** for these pieces |
| Accepted | **В работе у редакции**: «Редакция готовит Boks Series. Вернём её вам, когда закончим.» No edit, no withdraw; the composer opens read-only | The piece leaves the queue for **Boks Series в работе** (`studio_accept_bok`, `studio_series_work_list`) |
| In work | | **Собрать Boks Series** makes a Studio recorder draft with the title, the text, the author's byline and the author's chosen take copied in from `<seriesRoot>/voices/<bok>/` (`POST /api/series` `{ fromBok }`, `lib/boks/series-recorder/from-bok.ts`), and opens it in Запись Series. The kept build's token fills the token field; for a piece made by hand (`docs/link-only-pieces.md`) the team pastes one. The cover is set on the same card |
| Sent back | **Серия готова**: «Посмотрите и опубликуйте.», the usual preview and **Опубликовать** | **Отправить автору** (needs the cover): a `ready` Series work on the author's page for this bok (`studio_send_series_to_author`) |
| Published | **Опубликовано**, the Series on the author page | the card says when the author published it |

At any point before publishing, **Вернуть автору с причиной** on the card (or
**Вернуть на доработку** / **Отказать** in Moderation) answers with a reason
as in "When the editors cannot take a piece", unlocks the piece and takes a
sent series back.

The author publishes through the usual My page publish
(`publish_my_author_space`): terms, the request id, and a page that opens
together with its first works all stay as they were. `boks_publish_space_works`
now lets a work go out when its bok is still `pending_review` and the editors
sent it (`bok_series_work.state = 'sent'`): the bok becomes `published` with
its series.

What the database refuses:
- `save_my_bok` on a piece in work: «The editors are already making the Boks
  Series for this piece; it cannot be changed now.»
- `withdraw_my_sent_bok` on a piece in work, and on anything not waiting for
  the editors.
- `studio_accept_bok` without a current reading by the author, or for a piece
  not sent from My page.
- `studio_send_series_to_author` without the cover, a valid token, or a page
  to send it to.
- Publishing a piece sent from My page any other way (the old approve, the
  composer): trigger `reels_series_publish_guard`, unless the call is the
  author's publish of the sent series (a transaction setting
  `boks.series_publish`). Server jobs with no caller are not affected.

Data: `bok_series_work` (one row a piece: `accepted`, `sent`, `published` or
`returned`, who accepted it, the recorder draft, the work on the author's
page, the token, when it was sent and published). The piece stays
`pending_review` while it is in work, and the review queue
(`get_boks_admin_snapshot`) leaves it out.

## The editors' cover

**Send to the editors** puts a piece in the review queue (`pending_review`,
`reels.cover_requested`). Studio gives it a cover with the panel
(`components/boks/admin/team-cover.tsx`) in Moderation or on its card in
«Boks Series в работе»: it uploads a picture (`studio_set_bok_cover`) or
draws two with the same pipeline (admins are not counted against an author's
allowance) and picks one. The series goes to the author only with a cover,
and the database refuses publishing without one for every path (trigger
`reels_cover_before_publish`). So every bok goes out with a picture.

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
| `bok_editor_decisions`, `studio_decide_bok`, `studio_reopen_bok`, `studio_bok_decision`, `get_my_editor_decisions` | the editors' reasoned answer, `20261122140000_boks_editor_decisions.sql` |
| `bok_series_work`, `withdraw_my_sent_bok`, `get_my_series_work`, `studio_accept_bok`, `studio_series_work_list`, `studio_series_source`, `studio_link_series_draft`, `studio_send_series_to_author`, trigger `reels_series_publish_guard` | from a voiced piece to its Boks Series, `20261122200000_boks_author_series_flow.sql` |
| `bok_voices`, `set_my_bok_voice`, `get_my_bok_voice_access`, `get_my_bok_voices`, `studio_bok_voice`, `boks_voice_fingerprint` | the author's voice, `20261122120000_boks_author_voice.sql` |

Where a bok's picture comes from, in order:
1. a registered Series cover;
2. the catalogue artwork;
3. its own picture, `/b/<id>/cover.webp?v=<version>` (`lib/boks/own-cover.ts`).

The link card and the curtain loop use `/b/<id>/cover.jpg`. The version is in
the card's key, so a new picture also remakes the loop.

## Drawing

Since 2026-11-22 only Studio draws covers (`reserve_my_cover_drawing` refuses
anyone else), from the team-cover panel. `POST /api/author/covers` with the
caller's token; the database counts the pictures first. Then the route writes a job under
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
