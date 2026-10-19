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

Paths are from the repository root.

### Shared

| Path | What it is |
|---|---|
| `components/boks/reader-feed.tsx` | the ordinary feed, the button that opens either format, and the one `FinaleActions` both are given |
| `components/boks/reading-finale.tsx` | the single ending shared with HTML reading: optional aftertaste, like / comments / share / replay / next |
| `components/boks/cinema/voices.ts` | who reads what: the cast rule, the model, the stability per reading |
| `components/boks/cinema/voices.test.ts` | holds the cast and the one-credit-per-character rule |
| `components/boks/reading-music.ts` | lo-fi under ordinary silent reading; nothing to do with either format |
| `public/reading-music.mp3` | that track |
| `app/globals.css`, `app/formats-v44.css`, `app/reader-v44.css` | base format styling, v44 transport/shelf and shared ending |
| `components/boks/cinema/format-controls.tsx` | real-position transport, menu and Sound controls shared by both players |
| `components/boks/cinema/media-level.ts` | actual media gain, lazily activated from a volume gesture, with an HTML media fallback |

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
| `lib/boks/poetry/gesture.ts` | scene gestures as data, and their maths: cover crop, easing, drag, tap or gesture |
| `lib/boks/poetry/gesture.test.ts` | holds that maths |
| `components/boks/poetry/gesture-layer.ts` | the WebGL layer that redraws a gesture scene's picture |
| `components/boks/poetry/gesture-overlay.ts` | the 2D layer drawn over it: arrow, song, threads, flame, rain |
| `components/boks/admin/poetry-sandbox.tsx` | `/admin` → Poetry, for a poem with no boks yet |
| `scripts/build-poem-manifest.mjs` | builds a manifest from a recording's own alignment |
| `docs/farewell-russia-scene-map.json` | the first poem's scene map |
| `docs/poetry/<slug>/{scene-map,lines,alignment}.json` | a poem's three inputs, kept so the manifest can be rebuilt exactly |
| `lib/boks/poetry/shipped-poems.test.ts` | the standard every folder under `public/poetry/` is held to - files, timings, zones, scenes, theme |
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
| English, a British author's classic | male | **Julian** | `7p1Ofvcwsv7UBPoFNcpI` |

A British author's English classic may be read in a British voice where the
series has one for that gender (`narratorFor("en", gender, "british")`);
otherwise the ordinary English voice reads it.

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
| A poem's theme | **−13 dB** — part of the reading, not behind it. It was −10 until 2026-10-11, and readers found the music too loud across the series |
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

A format draws the reading and mounts the shared `ReadingFinale` at its end.
The ordinary HTML reader uses the same component inline. There is one surface:
four optional illustrated tags (Made me smile, Moved me, Surprised me, Want to
think), then like, comments, share, replay and the genuine next action. Several
tags are allowed; none is required. There is no Onward/Skip step and no action
that manually marks the bok complete.

Reader controls use the device's English/Russian preference, independent of the
piece's language. Titles, bylines and text retain their original language.
`reader-feed.tsx` supplies one `FinaleActions` and owns all product actions.
Draft aftertaste stays editable until leaving the bok or hiding the page, when
one attributed nonempty set is queued and flushed. The event contract remains
one aftertaste per session/bok; returning to that reading shows the locked set.
Feed next comes from the real served slate without wrapping. Series next uses
the actual published, language-filtered shelf order captured on entry; heard
marks may reorder the shelf but never the active chain. After the last piece,
return to the shelf. Read text retains this Series origin. The admin sandbox omits actions that require a real bok.

**The interface follows the interface language**, whatever language the piece
is in: the finale, the players' controls, a moment's hint, the series shelf
are Russian on a Russian device and English otherwise, or what the reader
pinned (`docs/adr/0015-interface-language-follows-the-device.md`). Titles,
authors and the texts themselves keep their own language. It is never a guess
from the piece.

### Shared playback controls

`format-controls.tsx` displays actual audio position with a decorative waveform
(not a measured amplitude trace). Poems seek by five seconds, cinema by fifteen.
Play attempts the real recording on entry; denied playback leaves an actionable
Play/retry or Read text path. Sound changes real voice gain and the poem theme
where one exists. A fresh cover Play starts at zero; Read text → Play can use the
actual position held in bounded in-memory resume state. It is not inferred from
telemetry and does not promise cross-device resume.

Format callbacks report playing/progress/ended to the reader. Only actual
foreground playback counts: covers, pauses, buffering, Sound menus, story
moments, account/comment/share sheets and endings hold the reading clock.
Hiding the page pauses playback; returning requires explicit Play. Scene and
word timing still comes from the shipped alignment/manifests. The v44 design
adds no Wild nights recording or fictional piece to the live shelf.

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
voice returns. The v44 moment explains the gesture and offers Continue from
the start, so the reader can leave a gesture without waiting or completing it.

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

### The poems that ship

| Poem | Boks id | Voice | Pictures | Lines per picture |
|---|---|---|---|---|
| «Прощай, немытая Россия» | none - sandbox only | Alex Bell | 4 | 2 |
| *The New Colossus*, Emma Lazarus | `202c3d9c-5a8e-4c91-8278-ab0fc4e602cf` | Sha | 4 | 3, 5, 4, 2 |
| *I Hear America Singing*, Walt Whitman | `3056ee24-d8c0-4963-923f-967213a3ec34` | Jerry B. | 4 | 2, 3, 4, 2 |
| «Зимнее утро», Пушкин | `61ba3680-210d-41ed-acae-39710a5af5c8` | Alex Bell | 4 in 5 scenes - the window returns on «погляди в окно» | 6, 5, 7, 6, 6 |
| «Весенняя гроза», Тютчев | `a49896d0-be71-4b1a-9380-590738af79a2` | Alex Bell | 4 | 4, 4, 4, 4 |
| «Ночь, улица, фонарь, аптека…», Блок | `c85132ea-8f0b-495f-a468-c3339c624fa2` | Alex Bell | 4 | 2, 2, 2, 2 |
| *Hope is the thing with feathers*, Emily Dickinson | `226ea7f3-9aa8-4c2f-b654-01ee67b53fb2` | Sha | 4 | 4, 4, 2, 2 |
| *A Dream Within a Dream*, Edgar Allan Poe | `9aa49ad9-579e-4721-881d-d84595a49975` | Jerry B. | 4 | 5, 6, 7, 6 |
| *The Tyger*, William Blake | `11cbb669-6c1b-4e03-a80a-27951c9abca9` | Jerry B. | 4 in 5 scenes - the opening returns with the closing stanza | 4, 4, 8, 4, 4 |
| *Ozymandias*, Shelley | `d86fa888-50ab-493d-ae34-8ad574fc0845` | Jerry B. | 4 | 3, 5, 3, 3 |
| *Invictus*, Henley | `c8e05b68-5a45-4eb0-935e-d8b0ad8e6b45` | Jerry B. | 4, redrawn 2026-10-14 - rain thinning picture by picture, and a hold that shelters the flame in the first | 4, 4, 6, 2 |
| *The Lake Isle of Innisfree*, Yeats | `9d42d01d-5a3e-4ddb-a334-3f4dfdf5dffe` | Jerry B. | 4 - a ring: grey pavement, the island, evening, the pavement again | 1, 3, 4, 4 |
| *O Captain! My Captain!*, Whitman | `7322a7ff-0abf-4aba-b340-49477030ebed` | Jerry B. | 4 | 8, 6, 2, 8 |
| *Remember*, Christina Rossetti | `da98c07c-3386-48b4-8d1f-be02a1ff6d74` | Sha | 4 | 4, 4, 4, 2 |
| «Узник», Пушкин | `8ca3bef0-9aa2-4d43-a21b-b9c3ed756aca` | Alex Bell | 4 | 4, 4, 2, 2 |
| «Утёс», Лермонтов | `af757f35-36d7-48b6-8db3-51c8bffaffb6` | Alex Bell | 4 | 2, 2, 2, 2 |
| «Шёпот, робкое дыханье…», Фет | `1d2e5f7a-2501-466c-a583-0b2dade47571` | Alex Bell | 4 | 2, 6, 2, 2 |
| «Мужичок с ноготок», Некрасов (из «Крестьянских детей») | `9db4cce3-9594-4a6c-a860-324a330e89f8` | Alex Bell | 4 | 4, 4, 8, 4 |
| «Не жалею, не зову, не плачу…», Есенин | `7082de8a-56c4-441e-82d2-2c1ecb3c2d2c` | Alex Bell | 4 | 4, 8, 4, 4 |
| «Первый снег», Брюсов | `7a67ce67-bceb-4e41-8f66-191718345880` | Alex Bell | 4 | 4, 4, 4, 4 |
| *Binsey Poplars*, Hopkins | `99ee280f-faf5-4026-99fc-9cbec9d79a2a` | Julian (British) | 4 | 1, 1, 16, 6 |
| *Song of the Redwood-Tree*, Part 1, Whitman | `dc5150c6-fb9b-417c-8b29-40d274103acc` | Jerry B. | 4 | 5, 14, 53, 10 |
| *The Old Vicarage, Grantchester*, Rupert Brooke | `afa5a1ed-3019-455e-b550-475c9a498db3` | Julian (British) | 4 - the third holds the long middle, as the brief asks for the complete poem | 6, 27, 106, 2 |
| *Because She Would Ask Me Why I Loved Her*, Christopher Brennan | `e07795ca-f5ee-4472-8646-f9dc64736c91` | Jerry B. | 4 - the second has a hold gesture: the reflections meet, the water stills | 2, 2, 8, 4 |
| *Australia*, Bernard O'Dowd | `8e2ae832-c00c-43f0-ba4b-0acd5653df03` | Jerry B. | 4, cinematic transitions - the second has a sideways gesture between Eden and Mammon | 4, 4, 3, 3 |
| *The Arrow and the Song*, Longfellow | `45035e98-5bbf-4f3f-bb1b-f88f2bc02ac2` | Jerry B. | 4, cinematic - draw back and let go: an arrow in the first, a song in the second, the song coming home in the last | 4, 4, 2, 2 |
| *A Noiseless Patient Spider*, Whitman | `011660ae-2795-4b28-bd77-0404a4a2a8ba` | Jerry B. | 4 - threads to the lights in the second and third; three that hold make a bridge | 2, 3, 3, 2 |
| *There is no Frigate like a Book*, Dickinson (1896 text) | `7cf8f28a-3d1a-49df-a4bb-b10a274e5347` | Sha | 4, page-turn transitions - a swipe turns the page | 1, 1, 2, 4 |
| *Napoleon's Farewell*, Byron | `abbf65a4-b64b-4d8d-aa92-2f3aee583b5a` | Julian (British) | 4, cinematic - a hold brings back the coronation in the clouds of the first and the eagle over Saint Helena in the last | 8, 4, 4, 8 |
| *Spirits of the Dead*, Poe (1829 text) | `0b94e076-f41d-4f81-a2d2-c1e1efe2d9e7` | Jerry B. | 4, cinematic - holding the candle in the second steadies it and draws the spirits out of the fog | 4, 6, 12, 6 |
| *One need not be a chamber to be haunted*, Dickinson (1891 text) | `8ec69ff8-473d-4fb9-a05d-92ae8567317a` | Sha | 4 - candles flicker; in the mirror a finger wipes the condensation off a reflection that stays | 4, 8, 4, 4 |
| *The Shadow on the Stone*, Hardy | `89cf5983-6c4b-466a-b0e8-79ea30a7d418` | Julian (British) | 4, cinematic - leaves fall; her shadow comes out of the branches in the second; dragging sideways in the third starts him turning and she fades | 4, 4, 12, 4 |

The last two were not in the catalogue and were added for this, through the
curated route in `docs/catalogue-import.md` §4b (`work/catalogue-2026-10-04/`,
`CATALOGUE_MIN_CHARACTERS=150` - Блок is 227 characters, under the floor that
exists to catch scrape debris). Dickinson and Poe were added the same way;
The Tyger was already there and only gained its production.

A dash standing alone between spaces - Dickinson's, Blok's «века —» - is
joined to the word before it by the manifest builder (no-break space), so it
can never wrap onto a row of its own; the word it joins closes the phrase.
A dash that opens a line is dialogue (Некрасов's «— «Уж больно…») and is
joined to the word after it instead.

### Adding a poem

The whole job is assets and JSON; the renderer, the finale and the tests come
with it. The two English poems were added this way in one pass, which is the
check that it works.

1. **Find the boks.** The poem must be in the catalogue to be offered to
   readers: `published_boks` by title gives the id. Take the text from the
   catalogue import (`work/catalogue-*/*.jsonl`) so the words match the boks
   exactly.
2. **Record it** with `/with-timestamps`, the author's-gender voice from
   `components/boks/cinema/voices.ts`, at verse stability (0.8). Two takes cost
   little; choose by dynamic range and share of silence - more room between
   lines matters more here than anywhere, because the words arrive in the
   picture. Assert the alignment's length equals the text's.
3. **Bring the voice to the series' level: −22 LUFS integrated**, after any
   silence is inserted and before anything is measured against it:

   ```bash
   ffmpeg -nostats -i edited.wav -af loudnorm=print_format=json -f null - 2>&1 | grep input_i
   ffmpeg -i edited.wav -af "volume=<−22 − input_i>dB,alimiter=limit=0.89:level=false" \
     -codec:a libmp3lame -b:a 128k -ar 44100 public/poetry/<slug>/narration.mp3
   ```

   The shipped readings sit between −21 and −24 LUFS. A voice new to the
   series can arrive far below that: Julian's first two takes were −30, and
   both poems shipped eight decibels quieter than everything beside them
   (fixed 2026-10-11). Gain only, never compression; the limiter only keeps
   the peaks under −1 dBTP.
4. **Generate the theme** to the recording's length, two takes, with
   `force_instrumental: true` and without the poem's title in the prompt -
   named, the model sings the poem, and the reader hears two voices at once.
   Run each take through speech-to-text and require zero words. Keep the one
   with less energy in 1–3 kHz and a steadier envelope
   (`docs/media-generation.md` §3–4).
5. **Measure the theme gain.** Active RMS of each (frames within 40 dB of the
   peak), then `20·log10(gain) = voice − theme − 13`. It goes in the scene map
   as `themeGain`.
6. **Convert the pictures** to WebP into `public/poetry/<slug>/scenes/`.
7. **Write the scene map** in `docs/poetry/<slug>/scene-map.json` - copy one of
   the existing ones. Per scene: image, `lines`, `textPreset`, `focalPoint`, and
   `safeZones` in fractions of the **screen**, not the image: a 9:16 picture on
   a phone loses about a tenth on each side. A zone that reaches the right edge
   starts at `y ≥ 0.08`, under the close button. Per poem: `palette`,
   `themeGain`, and when needed `textScale` (long lines: 0.82 for Lazarus, 0.68
   for Whitman's hundred-character ones) and `veil` (a daylight poem: 1.55 for
   Whitman).
8. **Build the manifest:**

   ```bash
   node scripts/build-poem-manifest.mjs <slug> docs/poetry/<slug>/alignment.json docs/poetry/<slug>/lines.json docs/poetry/<slug>/scene-map.json
   ```

   It refuses if the word counts disagree rather than cutting the poem in the
   wrong places.
9. **Register it** in `components/boks/poetry/poems.ts` against the boks id.
   One line. The sandbox lists it, the feed offers it, and the finale is
   shared, so a new poem has nothing to add there.
10. **Look at it** at phone size in WebKit (§6) - the tests cannot tell whether
   words sit on a face.

No new component, ever. If a poem needs something the renderer cannot do, the
thing to add is a preset or a scene-map field, not a component.

### Scene gestures

A scene can answer the reader's hand while the voice goes on - a **scene
gesture**, the `gesture` field of a scene in the scene map. Unlike a cinema
moment it never stops the reading and never waits: it is something the picture
does while it is on screen, and the poem is whole without it. Two exist, both
drawn by one WebGL shader over the scene's own picture
(`components/boks/poetry/gesture-layer.ts`; the maths, tested, in
`lib/boks/poetry/gesture.ts`):

| `kind` / `effect` | Gesture | What it does | Fields |
|---|---|---|---|
| `hold` / `converge-reflections` | press and hold | below `waterline` the picture is a reflection: at rest it ripples; held, the ripples die and the two halves slide `pull` towards the middle; released, the ripples return | `waterline`, `pull`, `ripple` (image fractions) |
| `drag-x` / `lean-between` | move sideways | one picture holding two worlds side by side; the camera pushes `zoom` towards `leftFocus` or `rightFocus`, warming the left or draining the right, and eases back to the ambiguous middle when released | `leftFocus`, `rightFocus`, `zoom` |
| `hold` / `shelter-flame` | press and hold | a flame drawn over the painted one leans in gusting wind; held, it stands upright; released, it bends and never goes out | `flame`, `size` |
| `fling` / `arrow`, `song` | draw back and let go | aimed like a bow from `origin`, opposite to the pull: an arrow that shrinks into the distance, or the same gesture as a golden wave | `origin` |
| `threads` / `filaments` | drag to a light | a thread from `anchor` follows the finger; let go on a light it holds, anywhere else it springs back. Once `bridgeAfter` hold, counted over the whole poem, the lights join into a luminous bridge | `anchor`, `lights`, `bridgeAfter` |
| `hold` / `recall-glory` | press and hold | a vision painted into the sky - at rest drained to storm grey and dimmed; held, its gold returns warmer than painted and the rest of the picture falls into shade; released, it sinks back into the cloud | `vision`, `radius` (half-width and half-height of a soft ellipse) |
| `swipe` / `turn-page` | swipe sideways | turns to the next picture (or back), seeking the voice to its first line; no canvas | - |
| `hold` / `summon-spirits` | press and hold | at rest a drifting fog veils everything but `figure` and the candle's light trembles; held, the flame steadies, the fog thins and moves away from `candle`, and the painted spirits come forward over about a second and a half; released, the fog closes again | `candle`, `figure`, `radius` |
| `wipe` / `clear-condensation` | rub with a finger | the `glass` rectangle is misted - blurred and greyed, with a bead texture; the finger's path is cleared and stays cleared for the session. The more is cleared, the further back the reflection settles | `glass` (x, y, width, height), `brush` (fraction of the glass's width) |
| `drag-x` / `turn-away` | move sideways, either way | the view swings towards `apparition` and she fades into light in proportion; released short of the end she returns, carried all the way (0.55 of the width) she stays gone | `apparition`, `radius` |

`converge-reflections`, `lean-between` and `recall-glory` redraw the picture
itself in WebGL (`components/boks/poetry/gesture-layer.ts`); the rest are drawn over it on a
2D canvas (`components/boks/poetry/gesture-overlay.ts`), and so is a scene's
`ambience` - something the picture does without a hand: `rain` (`intensity`,
`wind`; Invictus thins it 1 → 0.6 → 0.25 → none so the storm passes) and
`returning-song` (`from`, `to`; brighter when the reader sent a song away
earlier), `falling-leaves` (`count`, optional `sun`: a low light that drifts)
and `candle-glow` (`at`, `radius`). One ambience is itself a warp,
`emerge-shadow` (`shadow`, `radius`, `afterMs`): branch shadows sway, and
inside `shadow` the painted figure starts filled in by the sun - relit to the
stone around it, so the grain stays - and gives way over five seconds from
`afterMs` into the scene, by the recording's clock. Start it after the
dissolve (crossfade offset plus `transitionMs`). A warp gesture and a 2D
ambience may share a scene - the scene then has two canvases (Hardy's leaves
fall while the reader turns him round); two warps cannot, and the test says so.

All of them need **one** picture, not a before/after pair - the effect is a warp and a
grade of the frame itself. A quick tap still plays and pauses; a press longer
than 280 ms or a movement over 10 px is the gesture and does not. The `hint`
is shown once on the scene until the reader has tried it, and never in
recording mode. Give a gesture scene room: insert silence after its lines (see
step 3) so it holds for ten seconds or more - Brennan's has 3.5 s after «each to
each», O'Dowd's 2.5 s after «Eden ’neath your face». Without WebGL the canvas
stays empty and the `<img>` beneath it is the scene.

`transitionStyle: "cinematic"` on the scene map makes every change of picture
a settle as well as a dissolve: the arriving picture comes in from 6 % closer,
the leaving one drifts 3.5 % on. `"page-turn"` swings the arriving picture in
on its left edge, as a leaf turns, over the one beneath. Transform and opacity
only, both.

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

### A picture's lines stay together, two at a time

The lines one picture carries build up into a stanza: the first stays, dimmed
to half, while the second is spoken under it, and the stanza leaves with its
picture. **At most two lines are on screen.** A zone has two rows and a
picture's lines alternate between them, so a third line lands exactly where the
first was - the first starts leaving as the voice reaches the last word of the
line between them, so the two are never legible over each other. A sonnet over
four pictures, or a Whitman line of a hundred characters, stays a couplet
rather than becoming a page. Each row is as tall as the longest line it will
hold, so nothing is ever re-laid out; the two lines hug the boundary between
the rows. The stanza leaves with its picture (a 700 ms fade - longer and it lies legibly over the next stanza,
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
  re-rasterises glyphs every frame. A static blur is fine on a block or an
  image, but never on text in a flow: Safari 27 (iOS 27) leaves the filter
  buffer of an inline box uninitialised, so a blurred word is smeared and gets
  a magenta or grey bar across it. Soften words with `text-shadow` instead.
- **`text-shadow` in a keyframe.** The same problem as a blur: the glyphs are
  redrawn every frame, and while an arrival is also moving the word by
  fractions of a pixel an iPhone draws it in a slightly different place each
  time - the word trembles. `searchlight-scan` did this. A glow that comes and
  goes is a copy of the word (`::after` with `content: attr(data-text)`,
  transparent glyphs, only the shadow) whose opacity is animated.
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

## 5. The series shelf

Every finished piece in either format is also listed on the **boks series**
shelf - the second tab beside the feed, at `/series`. The shelf does not
decide how a piece opens (the two registries above still do); it draws a card
and asks the feed to open the boks, so the finale is the ordinary one.

Finishing a piece therefore has one more step:

1. A cover: a frame of the piece's own art, downsized -
   `cwebp -q 80 -m 6 -sharp_yuv -resize 720 0 <frame>.png -o public/series/<name>.webp`.
2. One entry in `components/boks/series/series-catalogue.ts`: format,
   language, cover and focus, duration, scene and moment counts, premiere date.
   Set `coverLogoTone: "dark"` when the upper artwork needs dark controls;
   the default is light. Reader native bars use the opposite neutral surface
   (white for dark ink, black for light ink), available before the image loads.

The hero and every preview display the recording duration from this registry,
using the interface language. Under one minute it is shown in seconds; longer
pieces use rounded minutes. This is the piece's playback length, not measured
foreground reading time. The hero scales with the actual shelf viewport;
its Play icon shares the byline row and the language button has a 44px target.

`series-catalogue.test.ts` fails if a finished piece is missing from the
shelf, if a shelf entry would open as plain text, if a cover is missing or too
heavy, or if the duration or counts disagree with the shipped recording. The
shelf shows every language by default. Its one control is a language filter
(the icon at the right of the Series wordmark), kept on this device, which offers exactly the
languages the pieces carry - a piece with `language: "it"` brings Italian with
it, named by `lib/i18n/content-languages.ts`. The feed's reading languages do
not apply to the shelf. The newest
piece the reader has not heard leads; it is called a premiere for 14 days.

### Recording mode, for filming a piece

An admin adds `?recording=1` to any reader address - `/series?recording=1`,
`/b/<id>?recording=1` - and both formats open with no interface over them: no
close button, no bar, no transport, no scene column, no "Continue" on a moment,
no pointer. The picture, the words, the moments and the finale stay. A tap on
the cinema cover starts from the beginning (never "continue from"); Space plays
and pauses, the arrows skip 15 seconds in cinema, Escape leaves. The flag is
read once in `reader-feed.tsx` and only applies to `user_profiles.role =
admin` - it hides controls and unlocks nothing (`components/boks/recording-mode.ts`).

`?recording=true` is equivalent. In immersive poems, text zones start at least
16% down the frame in recording mode so the Reels header does not cover the
words. Zones already below that boundary keep their position; ordinary
playback keeps every scene's original placement.

## 6. Before shipping

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

What has worked for the poems, run from a scratch folder rather than the repo:

- **WebKit at phone size** - `npm i playwright && npx playwright install webkit`,
  then `devices["iPhone 15"]`. It is Safari's engine, which is what most readers
  of this format hold. Against the dev server WebKit upgrades every `localhost`
  request to https (the CSP's `upgrade-insecure-requests`) and loads nothing;
  route the requests back to http and drop that header in the test browser.
  `page.tap(".poem__surface")` starts playback.
- **Screenshot by playback position, not by wall clock.** The audio starts some
  hundreds of milliseconds after the tap, so wait on the bar's `aria-valuenow`
  instead.
- **Detect blinks rather than look for them.** Sample every word's computed
  opacity each frame, and flag one that was visible and drops near zero while
  its stanza is still up and its row is not handing over. It found the
  end-of-line blink on every line of the first poem, and finds none now.
- A purple mark reported on an iPhone could not be reproduced in WebKit; no
  frame of text alone held a purple pixel. If it comes back, ask for a
  screenshot.

---

## 7. What it costs

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
