# Walt Whitman — Song of the Redwood-Tree (1874)

Recommended Boks title:

**Song of the Redwood-Tree — Part 1**  
*Walt Whitman · 1874 · Interactive interpretation by Boks*

This is a strong Stanford-specific entry point because the coastal redwood El
Palo Alto is the source of the redwood symbol used by Stanford. Do not imply
that Stanford created, commissioned, endorsed or owns this interpretation, and
do not place Stanford logos in the experience.

Use Part 1 of the public-domain poem rather than silently cutting unrelated
lines. Reference transcription:
`https://whitmanarchive.org/item/per.00015`

## Assets

All four files are 1080 × 1920 PNG without embedded text.

| File | Meaning | Suggested trigger |
|---|---|---|
| `01_ancient_redwood_before_touch.png` | The silent living tree | Opening state |
| `02_ancient_redwood_awakened.png` | The tree responds and its memory becomes perceptible | Successful hold |
| `03_canopy_voice.png` | The voice expands from one tree into the forest | Narration opens into the death-chant |
| `04_farewell_stump_and_sprout.png` | Absence, farewell and continuation | Final “My time has ended…” beat |

## Primary interaction: listen through the bark

Stack scenes 01 and 02 as aligned before/after layers. Ask the reader to touch
and hold the central bark. During the hold, reveal scene 02 with a soft radial
mask centred on the pointer and introduce a slow wooden resonance.

- Prompt: **“Hold the tree. Listen.”**
- Hold duration: 1.6–2.0 seconds.
- At 300 ms: begin very soft bark movement and an 80–110 Hz resonance.
- At 900 ms: reveal approximately half of scene 02.
- At completion: crossfade fully to scene 02 over 600–800 ms and start the tree's
  first spoken line.
- If the user releases early, retain partial progress for two seconds instead of
  resetting immediately.
- After five seconds without interaction, complete automatically so narration is
  never blocked.
- One tap, Enter or Space must also complete the action.
- Under `prefers-reduced-motion`, use a 250 ms dissolve with no expanding mask.
- Optional vibration on supported Android browsers: one restrained 20–30 ms pulse
  after completion. Never make vibration required.

The interaction is reusable: it only needs a before image, an after image, a
hold duration, mask position and completion event. No poem-specific animation
code is necessary.

## Suggested timeline

- Scene 01: title and the opening invocation, before the tree speaks.
- Scene 02: the first-person voice and farewell begin after the hold.
- Scene 03: transition upward as the forest, sea air and death-chant broaden the
  scale. A slow 2–3% vertical pan is sufficient.
- Scene 04: dissolve at the final acceptance of death. Remove almost all ambience
  for the last line and hold the empty frame for two seconds.

## Voice direction

Recommended voice: a low, textured, gender-neutral or male American voice,
perceived age 50–70. It should feel close, patient and grounded—not like a film
trailer, a deity or an imitation of Walt Whitman.

- Pace: 88–100 words per minute.
- Begin “A California song” as an invitation, not a proclamation.
- Give the tree's first-person lines more intimacy, not more volume.
- Use a long but natural breath before “Farewell”.
- Keep references to axes and falling restrained; the horror should come from
  inevitability rather than shouting.
- Let “My time has ended, my term has come” fall almost to a whisper.
- Hold 1.5–2 seconds of silence after the final line.

For TTS, choose a high-quality US-English narrative model with controllable
pace and sentence-level pauses. Do not clone a real actor or historical person.
Render dry narration first; add ambience separately so it can be ducked and
rebalanced.

## Sound design

- Scene 01: coastal forest air, distant ocean surge, occasional canopy movement.
- Hold interaction: a slow organic wooden resonance around 80–110 Hz, subtle
  enough to remain audible on a phone speaker. Avoid a conventional heartbeat.
- Scene 02: add faint inner creaks and drops falling from high branches.
- Scene 03: widen the ocean and canopy bed; keep birds sparse.
- Axes, if represented, should be distant dull wooden knocks—not a chainsaw and
  not a jump scare.
- Scene 04: cut the low resonance first, then reduce the forest bed nearly to
  silence. A final breath of wind is enough.
- Keep ambience 16–20 dB below narration and duck it by another 3–5 dB during
  speech. Music is unnecessary; if used, restrict it to a nearly inaudible drone.

## Text and UI

- Keep synchronized text as HTML, never baked into the artwork.
- Use a local scrim behind the current lines rather than darkening the complete
  image.
- Avoid placing text over the warm rings in scene 02 or the small sprout in scene
  04.
- Preload scene 02 before enabling the hold interaction.
- Record `hold_started`, `hold_completed`, `hold_duration_ms`, `auto_completed`
  and whether reduced-motion or keyboard fallback was used.
- Treat completion as exposure to the interaction, not proof of emotional
  engagement; collect the user's reaction separately after the poem.

## Rights note

Whitman's poem was published in 1874 and is in the public domain. Generated
illustrations and newly recorded narration are separate production assets. Do
not reuse modern commercial recordings or copyrighted Stanford photography.
