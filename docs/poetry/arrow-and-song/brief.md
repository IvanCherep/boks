# Henry Wadsworth Longfellow — “The Arrow and the Song”

The brief as it arrived with the pictures (`boks_investor_poems.zip`).

1. `01_longfellow_arrow_and_song_01_arrow_released.png`
2. `01_longfellow_arrow_and_song_02_song_released.png`
3. `01_longfellow_arrow_and_song_03_arrow_found.png`
4. `01_longfellow_arrow_and_song_04_song_found.png`

**Agent prompt (two sentences):** Create an immersive boks for Henry Wadsworth Longfellow’s “The Arrow and the Song,” using the four images in numerical order with narration, synchronized text, and slow cinematic transitions. Let the reader drag and release the arrow, turning the same gesture into a golden sound wave that disappears into the distance and returns in the final scene.

## Shared implementation notes

- Preserve `cover` positioning and reserve safe zones for synchronized text.
- Use slow parallax and 600–900 ms crossfades; avoid aggressive zooms.
- Respect `prefers-reduced-motion` with static crossfades and tap-only interactions.
- Narration must continue even if the reader does not perform the interaction.
