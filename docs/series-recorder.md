# Series recorder (beta)

Studio → Редакция → Запись Series. A poem read aloud through a teleprompter
becomes an immersive Series, built the way the hand-made author Series are
(`docs/link-only-pieces.md`, «Published author-held pieces»): the author's own
voice brought to the series' loudness, every word timed against the take,
pictures drawn for its lines, the stanzas fitted above the player. The result is a
link-only piece at `/l/<token>`. Studio uses it freely; an author uses it in
their cabinet (`/author#series`) once the team has granted them Boks Series.

## Hidden for authors (since 2026-11-22)

What authors made with it alone was below the team's quality, so the
self-serve recorder is hidden from every non-admin account until it is
better. One switch, `authorSeriesRecorderEnabled` in
`lib/boks/series-recorder/switch.ts`, now `false`:

- the cabinet shows no entry card (`series-entry.tsx`) and no recorder;
  `/author#series` goes back to My page (or the library without one);
- `POST /api/series` answers a non-admin 403 "Boks Series are made by the
  boks team for now…", before a Boks Series is spent;
- Studio keeps everything, in Studio → Запись Series and in its own cabinet;
- authors' existing drafts stay on disk untouched, and their grants
  (`series_credits`) stay as they were.

The composer's voice block uses the same teleprompter for a bok's reading;
that is the author's voice for the editors and stays
(`docs/author-publishing.md`, "The author's voice").

**To turn it back on:** set `authorSeriesRecorderEnabled = true`, run the
tests (`switch.test.ts` says it is off and must be changed with it), release.

## Boks Series for authors

The team grants an author a number of Boks Series in Studio → Authors
(`series_credits`, `20261117160000_boks_series_credits.sql`). A new
recording spends one (`spend_series_credit`, a single guarded update, so two
tabs cannot both spend the last), whatever becomes of it. Everything one
recording can cost is bounded on its own, so a grant of N bounds what an
author can spend:

| | per recording | |
|---|---|---|
| Pictures drawn | 8 | redraws included, deleted ones counted |
| Builds that stay | 2 | the first and one rebuild |
| Builds started | 6 | failed ones included; a failure of the voice service is given back |
| Takes | 5 at a time, 20 in all | recorded or uploaded |
| A take | 25 MB, 10 minutes | the worker measures the file itself |

An author's draft is signed with their own name and they cannot change it.
Studio's new draft starts signed with the recorder's own name too, since
people mostly record their own work: their author page's name, else their
byline when all their boks carry one (`ownName` in `get_my_series_access`,
`20261118140000`). The catalogue account has no own name and starts empty;
Studio can always type another author.

**An author's pictures are drawn, not uploaded** (owner's decision,
2026-11-21): an author makes them with Generate only, and the Pictures step
shows them no upload. Uploading a picture is Studio's; the store refuses an
author's (`addFile` with kind `image`, 403 "Pictures are drawn by boks").
Everything else stays the author's: generating, drawing again, switching
versions, deleting, building, the rebuild, choosing the version that stays,
publishing.

A take is refused unless its bytes are the audio its kind says (WebM, MP4,
Ogg, WAV, MP3). An author sees and touches only their own drafts; anyone
else's answers "No such draft". Studio sees every draft, with its owner's
@name, and none of the per-recording ceilings on builds or takes apply to it.
Who the caller is comes from the database with their own token
(`get_my_series_access`, `lib/boks/series-recorder/actor.ts`), never from the
request. The microphone is allowed on `/admin` and `/author` only.

**Straight onto the author's page.** On the Series step an author publishes
the version that stays to their page (`publish_my_recorded_series`,
`20261117170000_boks_recorded_series_publish.sql`): no review - the team
decided when it granted Boks Series. The bok is created published under
their byline, with a page work carrying the recording (`series_piece`,
rights note `series-recorder`), first on a page they have ordered; an author
without a page gets one. They may publish at most as many as they have made
(`series_credits.used`), so a direct call publishes nothing the recorder
could not; publishing a kept rebuild replaces the recording in place. A
draft changed since its build is refused, so the page never shows words the
recording does not say. Hiding and ordering are in My page, whose order view
shows the reader's page beside the list, live
(`/author/preview` in a phone frame, told each move by `postMessage`; the
preview works for an author without a prepared page too,
`20261117180000_boks_page_preview_for_every_author.sql`).

**Studio publishes onto the author's page too.** A recording made by a
Studio account (say the team reading an author's poem) has no page of its
own to go to: its Series step asks for the author's @handle, suggested from
the byline (`studio_series_author_for`: the account whose page carries that
name, else whose published boks do), and publishes there
(`studio_publish_recorded_series`,
`20261117190000_boks_studio_publish_recorded_series.sql`), under the author's
own name and not counted against their grant. Once published, the draft
remembers whose page it is on, and a kept rebuild replaces it there. In the
cabinet a Studio account sees only its own recordings; Studio → Запись
Series sees everyone's.

A recording made elsewhere can be uploaded on the Recording step: mp3, m4a,
wav, ogg or webm, up to ten minutes; it becomes a take like any other.

## The way through

1. **Text.** Title, author, the poem: one line of the poem a line, a blank
   line ends a stanza. Saved as you type.
2. **Recording.** The microphone with the browser's call processing off (echo
   cancellation, noise suppression and automatic gain flatten a reading), a
   level to check first. The teleprompter takes the whole screen: a
   three-second count, then the poem moves up past a band a third of the way
   down at the pace the poem was estimated to take; the line on the band is
   lit. Pace −/+, hold, arrows to nudge, Space stops, Escape drops the take.
   Up to five takes; listen, choose one (the first is chosen until another
   is). Attaching a recording of one's own is shown first, as an equal way.
3. **Pictures.** One to five, generated (and, in Studio only, uploaded), never reordered: a
   picture is replaced by deleting it and adding another. **Generate** draws
   one to four at a time (`seriesLimits.generate`), appended after the
   pictures there are: YandexGPT writes a scene from the lines each picture
   will carry, Alice AI Image draws it in the series' look
   (`lib/boks/series-recorder/art.ts`). A generated picture may be drawn
   again once; both versions stay and either can be shown. **A Series may
   have at most eight pictures generated**, redraws included and deleted
   ones still counted (`seriesLimits.artBudget`; `artUsed` on the draft, and
   `artAllowance` to give one draft more later). Pictures being drawn count
   at once; a drawing that fails spends nothing. The page shows the
   allowance as eight marks. Studio's uploads are made
   JPEG in the browser, at most 2160 px on the long side. Each picture is cut
   to 9:16 from its middle, and the lines it carries are shown under it.
4. **Series.** Build, watch the four steps, then the link, the length and
   the piece itself in a phone frame, opening behind the series curtain
   (`/l/<token>?curtain=1`). **One rebuild**: both versions stay, each with
   its own link-only folder, and the author chooses which one stays
   (`keepBuild`; the kept one's token is the draft's `token`). A build that
   fails counts for nothing. A build
   that fails says why in words (`buildErrors` in `messages.ts`); one that
   does not read the text lists the words missed and added.

The lines are shared between pictures by `linesPerPicture`
(`lib/boks/series-recorder/scene-plan.ts`): stanzas stay whole when there are
as many as pictures, unavoidable cuts fall evenly. Words start in the lower
middle of a picture, `raiseStanzaZones` lifts any stanza that would run under
the player, and the build refuses one that cannot fit.

Under every step a quiet "Something unclear, or an idea?" opens a small box;
the note lands in Studio → Feedback marked with the step (`series_text`,
`series_record`, `series_pictures`, `series_build`;
`20261117140000_boks_series_recorder_feedback.sql`).

The look of the pictures is the house's, not the author's: `artStyle` in
`art.ts`, after Алексей Прохоров's Series, is appended on the server and the
prompts never leave it (`readDraft` drops them).

## How it is built

| Part | Where |
|---|---|
| Studio page | `components/boks/admin/series-recorder/` (`series-recorder.tsx`, `teleprompter.tsx`, `microphone.ts`, `api.ts`, `messages.ts`), `app/series-recorder.css` |
| API (Studio, or an author with a grant, each to their own drafts) | `app/api/series/` → `lib/boks/series-recorder/store.ts` |
| Draft shape and limits | `lib/boks/series-recorder/rules.ts` |
| Word times and the text check | `lib/boks/series-recorder/alignment.ts` |
| Worker | `scripts/series-worker.mts` (`npm run series:worker`) |
| Generated pictures | `lib/boks/series-recorder/art.ts` |
| Shared with the hand-made path | `lib/boks/poetry/build-manifest.mjs` (also `scripts/build-poem-manifest.mjs`), `raiseStanzaZones` in `lib/boks/poetry/stanza-fit.ts` (also `npm run fit:poem`) |

Drafts are folders under `BOKS_SERIES_DIR`: `draft.json`, the takes
(`take-<n>.webm|mp4|…`), the pictures (`image-<n>.jpg`). A build is a file
queue, so the worker needs no database: the API writes `job.json` with a
snapshot of the draft; the worker renames it to `job.processing` (one worker,
one build at a time), writes `progress.json` per step and `result.json` at
the end, and swaps the finished folder into `BOKS_LINK_ONLY_DIR/<token>`
whole. The token is made on the first build and kept, so a rebuild keeps the
link. Pictures are drawn through the same queue (`art-job.json` →
`art-job.processing` → `art-result.json`, pictures as `art-<job>-<k>.jpg`);
the worker never writes `draft.json`, the next read takes the result in.

YandexGPT's content filter refused «азбука веры» asked with its title and
whole text (2026-11-15) but wrote every fragment of it, so the scenes are
asked from the fragments alone, then one fragment at a time, and only then
from a few quiet scenes of the series' own. The scenes are held to one look:
early morning, mist, cold light, one landscape a poem. Alice AI Image answers
768×1344 whatever size is asked; the build brings it to 1080×1920. About
2,23 ₽ a picture. A result remembers which draft it came from; changing the text, the
chosen take or the pictures marks it stale.

Per build, on the server: ffmpeg measures the take's loudness and brings it
to −22 LUFS by gain (a limiter catches peaks), mono; ElevenLabs forced
alignment and speech to text run on the same file; under 85% of the text
heard stops the build; the head is trimmed to 0.8 s before the first word and
the tail to 1.5 s after the last; pictures go to 1080×1920 WebP and a 720 px
cover. Measured on «Связь» (75 s): about 5 s of one core, the rest is waiting
for ElevenLabs. Recording happens in the author's browser and costs the
server nothing.

## When a service runs out

Neither is the author's to fix, and the page says so in plain words, with
the work kept:

- **ElevenLabs** out of quota (402, or 401 about quota) is `quota`; no answer
  after three tries is `service`. The build is "paused": the takes and
  pictures are saved, the team is on it, build again later.
- **Yandex** out of quota, billing stopped or not answering is `unavailable`:
  "picture generation is paused for now", upload your own (Studio) or come back
  later. Pictures are not on the critical path.

A build that breaks on our side for any other reason (`unexpected`) is
treated the same way: the author reads that the boks team already knows and
is fixing it, the takes and pictures are kept, and the attempt is given back.

Each of these, and a picture job that failed on our side, logs a
`series: ALERT …` line with the draft id; `deploy/ops/alerts.sh` forwards new
ones to the team's Telegram every minute (watermark
`/var/lib/boks-ops/series_alerts.since`, at most five a minute). A prompt
Yandex refused is the text's and is not an alert.

## Running it locally

The dev server must run on Node, as production does - under the default
workerd runtime the file system is virtual and every write fails with
"operation not permitted":

```bash
BOKS_PLATFORM=node BOKS_SERIES_DIR=/tmp/boks-series BOKS_LINK_ONLY_BASE_URL=http://127.0.0.1:5198 npx vinext dev --port 5174
(cd /tmp/boks-link-only && python3 -m http.server 5198 --bind 127.0.0.1)   # what /l/<token> reads
BOKS_SERIES_DIR=/tmp/boks-series BOKS_LINK_ONLY_DIR=/tmp/boks-link-only ELEVENLABS_API_KEY=… npm run series:worker
```

The key needs `speech_to_text`. Pictures need `YANDEX_API_KEY` and
`YANDEX_FOLDER_ID` for the worker: an API key of a service account with
`ai.imageGeneration.user` and `ai.languageModels.user`, scopes
`yc.ai.imageGeneration.execute` and `yc.ai.languageModels.execute` (the old
`art://…/yandex-art/latest` answers 403; the model is
`aliceai-image-art-3.0`). To try the worker without spending credits,
`ELEVENLABS_API_URL` points it at a local stand-in that answers
`/v1/forced-alignment` and `/v1/speech-to-text` with saved replies. ffmpeg and
cwebp must be on the PATH.

## Production

- **Drafts:** `/opt/boks/series-drafts`, mounted into both app copies
  (`BOKS_SERIES_DIR=/series-drafts`, `deploy/compose.yml`) and into the worker.
- **Worker:** the `series` service, always on, half a core and 512 MB
  (`deploy/series/Dockerfile`: Node, ffmpeg, cwebp). Every release bundles
  `scripts/series-worker.mts` with esbuild into `/opt/boks/series/worker.mjs`,
  which the container mounts, and restarts the worker when it changed; a
  build it was in the middle of is queued again. It writes finished pieces
  into `/opt/boks/link-only/<token>`, which Caddy serves to the app.
- **Keys:** `ELEVENLABS_API_KEY`, `YANDEX_API_KEY`, `YANDEX_FOLDER_ID` in
  `/opt/boks/.env`; after changing them, `docker compose up -d series`. Without
  them drafts and takes still work; a build says the voice service is paused,
  drawing says pictures are unavailable.
- **ElevenLabs relay:** ElevenLabs answers POSTs from the server in Russia
  with an "Access restricted" page (HTTP 200, HTML). So the worker calls it
  through the Cloudflare Worker `boks-elevenlabs` (`deploy/elevenlabs-relay`,
  deploy with `npx wrangler deploy -c wrangler.toml` from that folder):
  `ELEVENLABS_API_URL=https://boks-elevenlabs.tryboks.workers.dev` and
  `ELEVENLABS_RELAY_KEY` (the Worker's `RELAY_KEY` secret) in `.env`. It passes
  only the two recorder paths, only with the key; the ElevenLabs key stays on
  the server. A non-JSON answer is a `service` failure, never a crash.
- **First start:** `docker compose build series && docker compose up -d series`.
  Logs: `journalctl -t boks-series` or `docker compose logs series`.
- **Who may use it:** nobody but Studio until an author is granted Boks
  Series in Studio → Authors.

## Not in the beta

Gestures and effects on a picture, choosing where
the words sit on each picture, music under the voice, registering the result
as a bok on the shelf (still `docs/link-only-pieces.md` by hand), authors
using it themselves.
