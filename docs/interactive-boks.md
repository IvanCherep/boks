# Making an interactive boks

How to turn a text from the catalogue into the cinema format: pictures, a
recorded voice, scene changes, and one or two places where the story stops and
asks the reader to do something.

Read this before touching `components/boks/cinema/`. It is the whole process,
including the parts that were learned the expensive way.

---

## 1. What you must tell the user first

**You cannot produce the pictures. The user can.** So the first thing you do,
before writing any code, is tell them exactly what to generate — and give them
the prompts.

Say it in this shape, every time:

> For this piece I need **N images**:
>
> - **6 scene frames**, 9:16, one per scene of the story
> - For the *hold* effect: **2 frames of the same shot** — one without the glow,
>   one with it
> - For the *swipe* effect: **2 frames of the same shot** — one with the crowd
>   in front, one with them gone
>
> Here are the prompts: …

Never leave the user to work out which images an effect needs. Name the effect,
name the files, and say what must differ between them. The table in §4 is the
source for that.

**The rule that governs every pair:** `before` and `after` are the *same shot* —
same camera, same geometry, same composition, same light source positions. Only
the one thing the gesture controls may change. A pair that drifts (the lion's
head moves, the lamp shifts) reads as a glitch, because the effect is a
crossfade and the reader sees both at once.

Generate `after` by **editing** `before`, not by writing a second prompt from
scratch.

---

## 2. Voices

Fixed by rule, not by taste — see `components/boks/cinema/voices.ts`, which is
the executable copy of this table.

| Language | Author | Voice | voice_id |
|---|---|---|---|
| Russian | male | **Alex Bell** | `TUQNWEvVPBLzMBSVDPUA` |
| Russian | female | **Mariia** | `EDpEYNf6XIeKYRzYcx4I` |
| English | male | **Jerry B.** | `QuzlkGvsGTSxjYyGssV4` |
| English | female | **Sha** | `9GiYR5zXBWwc0khQNQA8` |

The author's gender picks the voice. It is a rule so that five hundred boks do
not each become an argument, and so the catalogue sounds like one series.

Model is `eleven_v4` for everything. Stability is the one setting that changes:

| Reading | stability | Why |
|---|---|---|
| prose | 0.5 | neutral |
| verse | 0.8 | an expressive reading invents its own rhythm and destroys the metre |
| expressive | 0.3 + inline tags | `[whispers]`, `[said softly]` in the text itself |

**All four are `rate: 1.0`** — one credit per character. Some Russian voices in
the library bill at ×2 or ×3. That is invisible on one piece and worth hundreds
of dollars across the catalogue, so check `rate` before ever swapping one.

### Recording a narration

```bash
curl -X POST "https://api.elevenlabs.io/v1/text-to-speech/<voice_id>/with-timestamps" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
  -d '{"text":"…","model_id":"eleven_v4","voice_settings":{"stability":0.5,"similarity_boost":0.8}}'
```

Use **`/with-timestamps`**, always. The response carries `alignment` with a time
for every character, and that alignment is the whole reason to use a recording
instead of the browser voice: the highlight follows where the voice actually is
rather than guessing from a reading rate.

Save the audio as `public/cinema/<slug>/narration.mp3` and the alignment as
`alignment.json`, then register both in
`components/boks/cinema/narration-track.ts`.

**MP3, not m4a.** AAC in an .m4a plays perfectly from its own URL and fails to
decode as a blob — and the blob is not optional, because it is what makes the
recording seekable when the server will not answer a range request.

---

## 3. Images

| | |
|---|---|
| Aspect | 9:16, portrait |
| Size | 941 × 1672 is what we have been given and it is enough |
| Delivered as | PNG |
| Shipped as | WebP |

Convert every image before committing. PNG at this size runs 2 MB and WebP runs
200 KB for the same picture:

```bash
cwebp -quiet -q 82 -m 6 -sharp_yuv in.png -o out.webp
```

`-sharp_yuv` matters: these pictures are warm gold on dark, and that is exactly
where chroma subsampling shows.

No UI, no text, no arrows and no hands in the image. Hints and controls are HTML
laid over it — they have to be, so a screen reader can reach them and so the
same picture serves both languages.

---

## 4. The effects, and the images each one needs

Twelve mechanics exist already, on five primitives. Nothing new has to be
written to use them: a piece supplies pictures and a line of configuration.

Browse and judge them at **`/admin` → Interactions**. The sandbox runs one at a
time with a frame counter, keeping the worst frame of the session — a scene can
hold a respectable average and still drop the one 200 ms frame that ruins it.

| Effect | Gesture | `before.png` | `after.png` | What may differ |
|---|---|---|---|---|
| `tap-light` | tap | dark study, lamp off | same study, lamp lit | **only the light** |
| `move-light` | drag finger | unlit street | lit street | **only the light** |
| `hold-focus` | press and hold | crowd and subject equal | subject lit, crowd in shadow | attention, not geometry |
| `wipe-frost` | rub | frosted glass | clear view through it | the glass only |
| `drag-door` | drag down | closed door | open door, room beyond | the door |
| `time-slider` | drag across | ballroom at night | same hall, cold morning | time of day |
| `tap-bell` | tap | still bell | struck, snow shaken loose | motion |
| `water-ripples` | tap | still reflection | rings spreading | the water |
| `reveal-ink` | drag right | empty line on paper | ink written there | the writing |
| `swipe-crowd` | swipe sideways | spectators in front | subject revealed | the crowd only |
| `hold-moment` | press and hold | room coming apart | room whole again | integrity |
| `pull-bookmark` | drag up | tab showing | ribbon drawn out | the bookmark |

The two in the lion are `swipe-crowd` and `hold-moment`-style heartbeat; they
live in `components/boks/cinema/story-moments.ts` with their own frames under
`public/cinema/<slug>/moments/`.

### Prompt template

Keep one style across a piece, or the scenes stop being one film:

> Vertical 9:16 cinematic literary illustration. [SCENE]. Victorian winter,
> deep navy and warm amber, lantern light, falling snow, realistic painterly
> rendering, no text, no UI, no hands.

Then for the second frame:

> Same image, same camera, same composition and geometry. Change only: [THE ONE
> THING]. Keep every other element identical.

---

## 5. Where the story stops

A moment is a hole cut in the narration. Two rules decide where, and both are
held by tests in `story-moments.test.ts`:

- **Never in the first or last fifth.** The opening has not earned a pause and
  nothing may interrupt the ending.
- **At least twenty seconds apart.** Two in quick succession turn a story into a
  sequence of tasks.

Pick the line, not the timestamp. The gesture must be what the sentence is
about. In the lion: the crowd lands straight after the tenderest line in the
story, because that is the line a crowd would queue to gawp at; the heartbeat
lands right before "через год собачка заболела и издохла", so the reader feels a
living chest and then the next sentence kills her. Anywhere else both are nice
animations.

Get the timestamps from the alignment, not by ear:

```bash
node -e 'const a=require("./public/cinema/<slug>/alignment.json");
let s="",t=0; a.characters.forEach((c,i)=>{ if(!s)t=a.character_start_times_seconds[i];
s+=c; if(/[.!?]/.test(c)){console.log(t.toFixed(1)+"s  "+s.trim()); s="";} });'
```

Behaviour that is already handled, so do not rebuild it: rewinding past a moment
arms it again; a hold runs a minimum four seconds whatever the finger does, so an
accidental tap still shows the reader what the mechanic is; the result stays up
in silence before the voice returns; a quiet "Продолжить" appears after nine
seconds for a gesture that has failed.

---

## 6. Sound

Recordings, not synthesis. Three layers of oscillators produced a heartbeat that
was recognisably a heartbeat and still sounded like a synthesiser.

```bash
curl -X POST "https://api.elevenlabs.io/v1/sound-generation" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
  -d '{"text":"…","duration_seconds":12,"prompt_influence":0.75,"loop":true}'
```

### Set the level by measurement, in the right band

This is the mistake worth not repeating. Matching full-band RMS put the
heartbeat at the narration's level and it was still inaudible on a phone:

| | energy above 300 Hz |
|---|---|
| narration | 57% |
| heartbeat | 2% |

A phone speaker does not reproduce below ~300 Hz, so the two matched on paper
and differed by 25 dB in the only band a handset can move. Measure **above 300
Hz**, not overall. Where the source genuinely has no mid-range, make one: drive
the low end into a soft clip to generate harmonics and band-pass what a small
speaker can play — `lib/boks/interactions/sound.ts` does this for the heart.

Reference levels, all against the narration's active level of −21.5 dBFS:

| | |
|---|---|
| Effect loops | match the voice |
| Music bed under speech | **−20 dB**, the middle of broadcast's 15–25 dB |
| Music bed while a moment holds | −12 dB |

And quiet is not enough on its own: a pad spread across 1–3 kHz blurs consonants
at any level, so the bed carries a −7 dB dip at 2 kHz. See
`components/boks/cinema/score.ts`.

Music is **not** part of generating the voice — text to speech returns speech
only. It is a second recording we lay under it, and it can be switched off by
the reader.

---

## 7. File map

```
public/cinema/<slug>/
  narration.mp3            the reading
  alignment.json           per-character timings from /with-timestamps
  score.mp3                optional music bed
  scenes/1..6.jpg          scene frames (the lion's predate the WebP rule above;
                           convert new ones)
  moments/<id>/before.webp
  moments/<id>/after.webp
  moments/<id>.mp3         the sound that moment makes

components/boks/cinema/
  voices.ts                who reads what
  narration-track.ts       recording + alignment registry
  scene-image.ts           scene frames registry
  story-moments.ts         where the story stops, and with what
  score.ts                 the music bed
  series.ts                a piece with both pictures and a voice opens to everyone
```

`series.ts` is the access rule: a boks with both its pictures and its recording
is open to every reader; everything else stays behind the admin flag. Nothing
lists which boks are open, because a list is a thing to forget to update —
finish a piece and it opens itself.

---

## 8. Before shipping

```bash
npm run lint && npm run typecheck && npm test && npm run build
npx supabase db push --linked   # only if a migration changed; before deploy
npm run deploy
git push github main
```

Never run `supabase config push` — it clears the Resend password from the auth
config and stops every sign-in email.

---

## 9. What it costs

Credits are characters on v4. A Creator month is 100,000.

| | credits |
|---|---|
| A 2–3 minute piece (~1,800 chars) | ~1,800 |
| Casting six voices on two passages | ~700 |
| Whole catalogue (2,126,582 chars) | ~2.1 M, around $480 at ×1 |

A ×2 voice turns that last figure into roughly $890. Check `rate`.

Audio generated on a paid month keeps its commercial licence permanently, even
after the plan lapses — so a month of generating is a month of generating, not a
subscription to maintain.
