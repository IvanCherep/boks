# Reading formats

A boks can be read in three ways. The ordinary feed is the product; the other
two are additions to it, opened from the same button, and chosen by the piece
rather than by the reader.

| Format | For | Opened by | Where it lives |
|---|---|---|---|
| **Feed** | everything | default | `components/boks/reader-feed.tsx` |
| **Cinema** | prose read aloud over scenes | the rail button | `components/boks/cinema/` |
| **Immersive poetry** | verse, words placed in the picture | the same button | `components/boks/poetry/` |

The reader never chooses between the last two.
`components/boks/reader-feed.tsx` looks the boks up and opens whichever renderer
it belongs to:

```ts
poemManifestFor(story.id)   // → immersive poetry
isBoksSeriesPiece(story.id) // → cinema
```

Neither touches the ordinary feed, which keeps working for every boks that is
in neither registry. Read this before changing anything under
`components/boks/cinema/` or `components/boks/poetry/`.

---

## 0. Every file, in full

Paths are from the repository root. On the machine this was written on that is
`/Users/iegorov/Documents/Codex/2026-09-09/fd`, but nothing depends on it -
work from the repo root wherever it is checked out.

### Shared

| Path | What it is |
|---|---|
| `components/boks/reader-feed.tsx` | the ordinary feed, the button that opens either format, and the one `FinaleActions` both are given |
| `components/boks/reading-finale.tsx` | the ending every format shares: aftertaste, then share / again / like / next |
| `components/boks/cinema/voices.ts` | who reads what: the cast rule, the model, the stability per reading |
| `components/boks/cinema/voices.test.ts` | holds the cast and the one-credit-per-character rule |
| `components/boks/reading-music.ts` | lo-fi under ordinary silent reading; nothing to do with either format |
| `public/reading-music.mp3` | that track |
| `app/globals.css` | all the CSS for both formats, at the end of the file |

### Cinema

| Path | What it is |
|---|---|
| `components/boks/cinema/cinema-mode.tsx` | the player: cover, playing, then the shared finale |
| `components/boks/cinema/series.ts` | the access rule - which boks are open to everyone |
| `components/boks/cinema/narration-track.ts` | recording and alignment, per boks |
| `components/boks/cinema/scene-image.ts` | the scene frames, per boks |
| `components/boks/cinema/scene-plan.ts` | cutting the text into lines and scenes; pure |
| `components/boks/cinema/narrator.ts` | the browser-voice narrator, and the `Narrator` contract |
| `components/boks/cinema/audio-narrator.ts` | the recording-driven narrator: seeking, fades |
| `components/boks/cinema/scene-art.tsx` | the drawn fallback scene, for a boks with no art |
| `components/boks/cinema/story-moments.ts` | where a story stops and asks something |
| `components/boks/cinema/story-moment.tsx` | the moment itself: gesture, sound, dwell |
| `public/cinema/<slug>/narration.mp3` | the reading |
| `public/cinema/<slug>/alignment.json` | per-character timings |
| `public/cinema/<slug>/scenes/` | scene frames |
| `public/cinema/<slug>/moments/<id>/{before,after}.webp` | a moment's two frames |
| `public/cinema/<slug>/moments/<id>.mp3` | the sound that moment makes |

Tests:

- `components/boks/cinema/scene-plan.test.ts`
- `components/boks/cinema/narration-track.test.ts`
- `components/boks/cinema/scene-image.test.ts`
- `components/boks/cinema/series.test.ts`
- `components/boks/cinema/story-moments.test.ts`
- `components/boks/cinema/shipped-alignment.test.ts` - checks the recording that
  ships against the text that ships, because when they disagree the highlight
  dies silently

### Immersive poetry

| Path | What it is |
|---|---|
| `lib/boks/poetry/manifest.ts` | types and all the pure logic: which line, which scene, which phrase |
| `lib/boks/poetry/manifest.test.ts` | every rule above, asserted against the shipped manifest |
| `components/boks/poetry/immersive-poem.tsx` | the renderer; knows no particular poem |
| `components/boks/poetry/poems.ts` | which boks open in it |
| `components/boks/admin/poetry-sandbox.tsx` | `/admin` → Poetry, for a poem with no boks yet |
| `scripts/build-poem-manifest.mjs` | builds a manifest from a recording's own alignment |
| `docs/farewell-russia-scene-map.json` | a working scene map to copy |
| `public/poetry/<slug>/manifest.json` | lines, word times, scenes, levels |
| `public/poetry/<slug>/narration.mp3` | the reading |
| `public/poetry/<slug>/theme.mp3` | the piece's own theme |
| `public/poetry/<slug>/scenes/` | scene frames |

### The effects library, shared by both

| Path | What it is |
|---|---|
| `lib/boks/interactions/scenes.ts` | the twelve mechanics as data, and the gesture maths; pure |
| `lib/boks/interactions/scenes.test.ts` | drag along one axis, snap, brush coverage |
| `lib/boks/interactions/sound.ts` | the sound palette, and the loops a moment uses |
| `components/boks/interactions/interactive-scene.tsx` | one engine for all twelve |
| `components/boks/admin/interaction-sandbox.tsx` | `/admin` → Interactions, with a frame counter |
| `public/interactions/<effect>/{before,after}.webp` | each effect's two frames |

---

## What you must tell the user first

**You cannot produce the pictures.** So before writing code, say exactly what
to generate and give them the prompts. Name the format, the count, and what has
to differ between any pair of frames. §3 and §4 have the specifications.

Never leave the user to work out which images a format or an effect needs.

---

## 1. Shared ground

### Voices

Fixed by rule, not by taste. `components/boks/cinema/voices.ts` is the
executable copy and both formats use it.

| Language | Author | Voice | voice_id |
|---|---|---|---|
| Russian | male | **Alex Bell** | `TUQNWEvVPBLzMBSVDPUA` |
| Russian | female | **Mariia** | `EDpEYNf6XIeKYRzYcx4I` |
| English | male | **Jerry B.** | `QuzlkGvsGTSxjYyGssV4` |
| English | female | **Sha** | `9GiYR5zXBWwc0khQNQA8` |

Model `eleven_v4`. Stability is the one setting that changes with the material:
prose 0.5, verse 0.8 for metre, 0.3 with `style` up when the piece wants acting.
All four voices are `rate: 1.0` — one credit per character. Some Russian voices
in the library bill at ×2 or ×3, which is invisible on one piece and worth
hundreds of dollars across the catalogue, so check `rate` before swapping one.

Always record through **`/with-timestamps`** - the key, the scopes, the costs
and the failure codes are in `docs/media-generation.md`:

```bash
curl -X POST "https://api.elevenlabs.io/v1/text-to-speech/<voice_id>/with-timestamps?output_format=mp3_44100_128" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
  -d '{"text":"…","model_id":"eleven_v4","voice_settings":{"stability":0.5,"similarity_boost":0.8}}'
```

The response carries a time for every character. That alignment is the whole
reason to use a recording rather than the browser voice: nothing is estimated.

**MP3, never m4a.** AAC plays from its own URL and fails to decode as a blob,
and the blob is what makes a recording seekable when the server will not answer
a range request.

### Pictures

9:16, 941 × 1672, delivered as PNG and shipped as WebP:

```bash
cwebp -quiet -q 82 -m 6 -sharp_yuv in.png -o out.webp
```

Roughly ten times smaller. `-sharp_yuv` matters: these are warm gold on dark,
which is exactly where chroma subsampling shows. No UI, no text, no arrows and
no hands in the image — all of that is HTML over the top, so a screen reader can
reach it and one picture serves both languages.

### Audio levels: measure in the band that reaches a listener

The mistake worth not repeating. Matching full-band RMS put a heartbeat at the
narration's level and it was still inaudible on a phone:

| | energy above 300 Hz |
|---|---|
| narration | 57% |
| heartbeat | 2% |

A phone speaker does not reproduce below ~300 Hz, so the two matched on paper
and differed by 25 dB where it counts. **Measure above 300 Hz.** Where a source
genuinely has no mid-range, make one: drive the low end into a soft clip to
generate harmonics and band-pass what a small speaker can play —
`lib/boks/interactions/sound.ts` does this for the heart.

Reference levels, against the narration's active level:

| | |
|---|---|
| Effect loops | match the voice |
| A poem's theme | **−10 dB** — part of the reading, not behind it |
| Music under speech generally | −20 dB, the middle of broadcast's 15–25 dB |

Quiet is not enough on its own: anything spread across 1–3 kHz blurs consonants
at any level and needs a dip there as well.

---

## 2. Which format a piece gets

Prose with scenes → cinema. Verse → immersive poetry. The difference is not
length: it is whether the words belong **over** a picture or **inside** one.

- **Cinema** keeps the text as a page you read while a voice reads it, with the
  picture behind. It suits a story.
- **Immersive poetry** puts individual words into the frame at the moment they
  are spoken. It suits verse, where the line is the unit and there are few
  enough words to place.

Words arriving one by one inside a picture is right for sixteen seconds of
verse and exhausting for ten minutes of prose. That is why there are two
formats and not one with a setting: what differs is how the words are given,
and that is the whole of what a format owns.

### What every format shares: the finale

A format draws the reading. It never draws its own ending. Every boks series
piece, whatever it was read in, ends on the same two screens from
`components/boks/reading-finale.tsx`:

1. **Aftertaste** — «Что осталось?», four tags (Улыбнуло, Задело, Удивило,
   Хочу обдумать), several allowed, none required; «Дальше» once something is
   picked, «Пропустить» otherwise.
2. **Where next** — «Куда дальше?»: Поделиться (the accent), Послушать снова
   and Нравится side by side, Выбрать следующую.

The format's side of it is two lines: mount `<ReadingFinale>` when the reading
is over, with the piece's language and a way to start again, and hide its own
controls underneath. What the buttons do is not the format's business -
`reader-feed.tsx` builds one `FinaleActions` (like, share, next, record the
aftertaste once per opening) and hands the same object to every format, so a
like at the end of a poem is exactly the like at the end of a story. The admin
sandbox passes none, and the finale leaves out what would need a boks.

Do not give a format an ending of its own, a different set of buttons, or
different words for the same buttons. If the finale needs to change, it
changes for every piece at once.

---

## 3. The cinema format

### What a piece needs

| | |
|---|---|
| `public/cinema/<slug>/narration.mp3` | the reading |
| `public/cinema/<slug>/alignment.json` | per-character timings from `/with-timestamps` |
| `public/cinema/<slug>/scenes/` | one frame per scene |
| `public/cinema/<slug>/moments/` | optional: a pair of frames and a sound each |

Registered in `components/boks/cinema/narration-track.ts` (recording and
alignment) and `components/boks/cinema/scene-image.ts` (frames).
`components/boks/cinema/series.ts` is the access rule: a boks with **both** its pictures and
its recording is open to every reader, everything else stays behind the admin
flag. Nothing lists which are open — finish a piece and it opens itself.

### Moments

A moment is a hole cut in the narration: the voice stops, something is heard,
and it only goes on once the reader has done the thing. Declared in
`components/boks/cinema/story-moments.ts`, drawn by
`components/boks/cinema/story-moment.tsx`.

Two placement rules, both held by tests:

- **Never in the first or last fifth.** The opening has not earned a pause and
  nothing may interrupt the ending.
- **At least twenty seconds apart.** Two in quick succession turn a story into a
  sequence of tasks.

Pick the line, not the timestamp. In the lion, the crowd lands straight after
the tenderest line in the story — the line a crowd would queue to gawp at — and
the heartbeat lands immediately before "через год собачка заболела и издохла".
The placement is the effect; anywhere else these are nice animations.

Get timestamps from the alignment, never by ear:

```bash
node -e 'const a=require("./public/cinema/<slug>/alignment.json");
let s="",t=0; a.characters.forEach((c,i)=>{ if(!s)t=a.character_start_times_seconds[i];
s+=c; if(/[.!?]/.test(c)){console.log(t.toFixed(1)+"s  "+s.trim()); s="";} });'
```

Already handled, so do not rebuild it: rewinding past a moment arms it again; a
hold runs a minimum four seconds whatever the finger does, so an accidental tap
still shows what the mechanic is; the result stays up in silence before the
voice returns; a quiet escape appears after nine seconds for a gesture that has
failed.

### The twelve effects

Twelve mechanics on five primitives already exist — `toggle`, `hold`, `drag`,
`mask`, `slider`. A piece supplies pictures and a line of configuration; no new
component is needed. Judge them at **`/admin` → Interactions**, which runs one
at a time with a frame counter that keeps the worst frame of the session, since
a scene can hold a respectable average and still drop the one 200 ms frame that
ruins it.

| Effect | Gesture | What may differ between the two frames |
|---|---|---|
| `tap-light` | tap | **only the light** |
| `move-light` | drag | **only the light** |
| `hold-focus` | hold | attention, not geometry |
| `wipe-frost` | rub | the glass only |
| `drag-door` | drag | the door |
| `time-slider` | drag across | time of day |
| `tap-bell` | tap | motion |
| `water-ripples` | tap | the water |
| `reveal-ink` | drag right | the writing |
| `swipe-crowd` | swipe | the crowd only |
| `hold-moment` | hold | integrity |
| `pull-bookmark` | drag up | the bookmark |

**The rule for every pair:** same shot — same camera, geometry, composition and
light. Only the one thing the gesture controls may change. Generate `after` by
**editing** `before`, never from a second prompt: the effect is a crossfade and
the reader sees both at once.

### Prompt template

> Vertical 9:16 cinematic literary illustration. [SCENE]. [PERIOD AND PALETTE],
> realistic painterly rendering, no text, no UI, no hands.

Then for the second frame:

> Same image, same camera, same composition and geometry. Change only: [THE ONE
> THING]. Keep every other element identical.

### Music

A cinema piece **does not get a score**. One was built and removed: generating a
theme per boks produces music that is about nothing. A theme has to come out of
the story, and a prompt describing the story is not that.

What exists instead is unrelated and lives outside the cinema: one lo-fi track
for the whole catalogue, played under ordinary silent reading, off until the
reader asks for it — `components/boks/reading-music.ts`. It works precisely
because it is the same for every boks and claims to be about nothing.

---

## 4. The immersive poetry format

The voice sets the pace, the picture changes with the sense, and each word
arrives in the frame at the moment it is spoken.

`audio.currentTime` is the only clock. Every visible thing is a function of it,
computed in one frame, which is what makes pause, seek and a backgrounded tab
land exactly where they should. A chain of timers would do none of that and
would look fine until someone scrubbed.

### Files

```
public/poetry/<slug>/
  manifest.json        everything: lines, word times, scenes, levels
  narration.mp3        the reading
  theme.mp3            the piece's own theme
  scenes/*.webp        one frame per scene
```

```
lib/boks/poetry/manifest.ts        types and the pure logic, all tested
components/boks/poetry/
  immersive-poem.tsx               the renderer; knows no particular poem
  poems.ts                         which boks open in it
scripts/build-poem-manifest.mjs    builds a manifest from a recording
```

### Adding a poem

1. **Record it** with `/with-timestamps` at verse stability.
2. **Convert the pictures** to WebP into `public/poetry/<slug>/scenes/`.
3. **Write a scene map** — see `docs/farewell-russia-scene-map.json` for a
   working one. Each scene names its image, its `lines` count, a `textPreset`,
   a `focalPoint`, and `safeZones` in fractions of the frame.
4. **Build the manifest:**

   ```bash
   node scripts/build-poem-manifest.mjs <slug> <alignment.json> <lines.json> <scene-map.json>
   ```

   It refuses if the word counts disagree rather than cutting the poem in the
   wrong places.
5. **Register it** in `components/boks/poetry/poems.ts` against the boks id.
   One line, nothing else. The ending comes with it: the finale is shared, so
   a new poem has nothing to add there.

No new component, ever. If a poem needs something the renderer cannot do, the
thing to add is a preset, not a component.

### How many pictures

Fewer than you think. Eight frames across seventeen seconds is a change every
two, which is not long enough to be anywhere. A scene carries two lines, and a
stanza that is one movement can carry four. Tests hold it: **every scene stays
longer than three and a half seconds** and spends more of that still than
dissolving.

### The two rhythms must not coincide

The picture changes **after** the line has landed, not with it —
`crossfadeOffsetMs`, currently 380 ms. A line begins, its first word arrives in
the picture belonging to the line before it, that image is held while the word
is still in the air, and only then does the scene turn. Changing both on the
same beat is what makes a short poem feel cut rather than read.

Two things in the renderer exist because of this and are easy to break:

- The backdrop walks **scenes**, not lines, and shows the last picture whose
  dissolve has actually finished. Reading the scene off the current line puts
  the new picture up on the same beat as the word.
- The arriving picture sits **on top** (`z-index: 1`). Without it, whenever the
  arriving scene comes earlier in the document the dissolve is painted under an
  opaque outgoing picture — invisible, and then the picture changes in one
  frame, which looks exactly like a stutter.
- **The whole backdrop is written by the frame loop, in one frame**
  (`paintBackdrop`). Each scene has its own `<img>`, mounted once and never
  given another `src`; the loop sets which is showing, which arriving, how far,
  and which are `visibility: hidden`. It used to be split — the dissolve's
  opacity written directly, which picture was showing through React state that
  commits after the frame is painted — and on the last frame of every dissolve
  the previous scene came back whole for one frame. Nothing about the backdrop
  may go through React state or a class.

### Words are lit by phrase, not one at a time

A word going out as the next comes on happens thirty-three times in a short poem
and reads as a blinking line however accurately it is timed. Words still arrive
one at a time with the voice, but inside a phrase the light only grows and goes
out once.

The grouping is the poem's own punctuation: a phrase runs up to and including
the word that closes it. The builder marks that word `emphasis: "lead"` — it is
also the word set half again as large — and numbers the phrases from it.

### A picture's lines stay together

The lines one picture carries build up into a stanza: the first stays, dimmed
to half, while the second is spoken under it, and the stanza leaves with its
picture (a 700 ms fade - longer and it lies legibly over the next stanza,
which usually lands in the same part of the sky). A line shown on its own
lasted two seconds and went out exactly where the next was arriving, which is
what read as the text flickering. Inside a zone each line is a row of its own
(`.poem__verse`), so the second line never shifts the first.

A word is lit `tokenLeadMs` (220 ms) **before** it is spoken, so its half-second
arrival has finished by the time the voice gets there, and the word before it
dims over nearly a second rather than being cut.

### The presets

Named in the scene map, drawn in CSS, with `quiet-breath` as the fallback so an
unknown name is plain rather than unstyled.

`farewell-drift`, `social-hierarchy-split`, `uniform-formation`, `quiet-breath`,
`ridge-reveal`, `shelter-reveal`, `searchlight-scan`, `echo-fade`.

`social-hierarchy-split` is the one that splits a line between two parts of the
frame — "Страна рабов," low, "страна господ," high. Only the line the picture
was composed around splits; a scene names which with `splitLine`.

### Never animate these

Learned the expensive way, each one having caused a visible stutter:

- **`filter: blur()` in a transition.** It cannot run on the compositor and
  re-rasterises glyphs every frame. A static blur is fine; an animated one is
  not.
- **Anything that changes a word's width** — `letter-spacing`, `font-weight`,
  `font-size`. These words sit in a flow, so a width that moves with the reading
  re-lays the whole line on every word and shakes the screen. Use `scale`.
- **Picking the lit word as "the active one".** The renderer reads ahead of
  the voice, so in the last 220 ms of every line no word is active and the
  fallback was the first word - every later phrase went to zero for a frame
  and came back. `wordReachedAt` takes the last word that has begun, and a
  test holds it.
- **A custom property on the root element.** It invalidates style for everything
  beneath it. The dissolve is an inline `opacity` on the arriving picture,
  `--played` goes on the control bar.

Also: the scene pictures ask for promotion up front (`will-change: opacity`),
because a layer sitting at zero opacity may never be rasterised and the first
dissolve would otherwise pay for the texture upload at the moment it began.

---

## 5. Before shipping

```bash
npm run lint && npm run typecheck && npm test && npm run build
npx supabase db push --linked   # only if a migration changed; before deploy
npm run deploy
git push github main
```

Never run `supabase config push` — it clears the Resend password from the auth
config and stops every sign-in email.

### Looking at it

Headless Chrome here ignores `--window-size` and advances time virtually, so it
crops captures and cannot measure frame rate. Two things that do work:

- Serve `dist/client` over HTTP and render against the **built** CSS. Fonts are
  referenced from the site root, so a `file://` harness silently falls back to
  Georgia and every width read off it is wrong.
- Have the page print its own `getBoundingClientRect` values into the DOM and
  screenshot that. Measured geometry beats a cropped picture.

Frame timing cannot be measured in this environment. Say so rather than implying
a profile was taken.

---

## 6. What it costs

Credits are characters on v4; a Creator month is 100,000.

| | |
|---|---|
| A 2–3 minute prose piece | ~1,800 |
| A short poem | ~200 |
| A theme or a music bed | **~820 per minute**, whatever the text |
| Casting six voices on two passages | ~700 |
| The whole catalogue (2,126,582 chars) | ~2.1 M, around $480 at ×1 |

A ×2 voice turns that last figure into roughly $890. Check `rate`.

Audio generated during a paid month keeps its commercial licence permanently,
even after the plan lapses — so a month of generating is a month of generating,
not a subscription to maintain.
