# William Ernest Henley — “Invictus”

The brief as it arrived with the pictures (`boks_investor_poems.zip`).

1. `03_henley_invictus_01_night.png`
2. `03_henley_invictus_02_unbowed.png`
3. `03_henley_invictus_03_gate.png`
4. `03_henley_invictus_04_captain.png`

**Agent prompt (two sentences):** Create an immersive boks for William Ernest Henley’s “Invictus,” using the four images in numerical order with narration, synchronized text, and a storm that gradually subsides. While the reader holds the screen, keep the central flame upright against the wind; when released it bends without going out.

## Shared implementation notes

- Preserve `cover` positioning and reserve safe zones for synchronized text.
- Use slow parallax and 600–900 ms crossfades; avoid aggressive zooms.
- Respect `prefers-reduced-motion` with static crossfades and tap-only interactions.
- Narration must continue even if the reader does not perform the interaction.
