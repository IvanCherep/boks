# Rupert Brooke — The Old Vicarage, Grantchester

Four vertical 9:16 backgrounds for an immersive Boks reading. All images are
1080 × 1920 PNG and contain no embedded text.

## Narrative sequence

| File | Meaning | Suggested trigger |
|---|---|---|
| `01_berlin_misted_window.png` | Distance, Berlin, homesickness | Opening state |
| `02_grantchester_reveal.png` | Memory appears behind the wiped glass | User wipes or holds the window |
| `03_river_cam_twilight.png` | The reader has entered the remembered landscape | Crossfade after the reveal |
| `04_honey_still_for_tea.png` | The church clock and final image of honey for tea | Final two lines |

## Recommended interaction

Use scenes 01 and 02 as aligned before/after layers. Scene 02 sits below scene
01. A soft circular brush updates a mask on pointer movement, revealing scene
02. Suggested brush radius: 56–72 CSS px with a feathered edge of 18–24 px.

- Prompt: “Wipe the glass to return to Grantchester.”
- Complete automatically after roughly 35% of the central window is cleared.
- When complete, crossfade fully to scene 02 over 700–900 ms.
- Do not block narration: after 4 seconds of inactivity, reveal the landscape
  automatically.
- Keyboard/accessibility fallback: one tap, Enter or Space performs the reveal.
- With `prefers-reduced-motion`, use a 250 ms dissolve without the moving mask.
- Scenes 02 → 03 → 04 can use restrained 900–1200 ms dissolves and no bespoke
  animation.

Suggested literary mapping for a short version clearly labelled “Selected
passages from…”:

- Scene 01: opening through “The poppy and the pansy blow…”
- Start reveal at “Oh! there the chestnuts, summer through”.
- Scene 02: the remembered summer landscape.
- Scene 03: final reflective passage beginning “Ah God! to see the branches stir”.
- Scene 04: “Stands the Church clock at ten to three? / And is there honey still
  for tea?”

If the complete poem is used, retain the same four scenes but hold scene 03
through the long middle section. Do not silently abridge the poem.

## Voice direction

Recommended voice: warm British male voice, perceived age 25–35, soft modern
RP or a neutral southern-English accent. The delivery should feel like a person
remembering a beloved place, not a formal poetry recital and not an imitation
of Rupert Brooke.

- Pace: 105–115 words per minute; allow the final passage to slow to 90–100.
- Opening: intimate, slightly tired, almost conversational.
- Contrast “here” in Berlin with “there” in England, but avoid melodrama.
- Treat the comic place-name sequence lightly and quickly rather than making it
  the emotional centre.
- Let “But Grantchester! ah, Grantchester!” bring the first open warmth.
- Pause 600–800 ms before the final question.
- Read “And is there honey still for tea?” quietly, with genuine uncertainty;
  hold 1.5–2 seconds of silence afterward.

## Sound design

- Scene 01: close rain on glass, distant café/street murmur, almost no music.
- During the wipe: crossfade the city bed into leaves, water and sparse birds;
  avoid a magical whoosh.
- Scene 03: low river movement and chestnut leaves. Keep birds intermittent.
- Scene 04: nearly silent garden; one subtle porcelain or spoon sound may follow
  the last line. Do not use a church chime—the clock reads 2:50, so it would not
  naturally strike.
- Keep ambience at least 16–20 dB below narration and duck it another 3–5 dB
  while words are spoken.
- Music is optional. If used, choose an almost imperceptible sustained texture,
  not sentimental piano or an orchestral climax.

## Editorial note

The complete poem contains dated language and references that may require a
short historical-content note. If only the opening and closing passages are
used, label the experience explicitly as selected passages and link to the
complete public-domain text. For an experiment, record whether participants saw
the full or selected version because length and omitted material affect the
comparison.

## Visual implementation notes

- Place synchronized text in a separate HTML layer; do not bake text into the
  images.
- Apply a responsive bottom gradient only when needed for contrast rather than
  darkening the entire artwork.
- Keep interface controls inside mobile safe areas.
- Preload scene 02 before enabling the wipe interaction to prevent a blank flash.
- If the clock must be semantically exact at every resolution, place two small
  SVG clock hands over the painted face in the UI (minute hand at 300°, hour
  hand at 85°). Generated artwork should remain atmosphere; the interface can
  guarantee the precise 2:50 state.
- Record `reveal_started`, `reveal_completed`, completion time and auto-fallback
  separately; do not treat arbitrary pointer movement as meaningful engagement.
