# Walt Whitman — “A Noiseless Patient Spider”

The brief as it arrived with the pictures (`boks_investor_poems.zip`).

1. `02_whitman_noiseless_patient_spider_01_isolation.png`
2. `02_whitman_noiseless_patient_spider_02_filament.png`
3. `02_whitman_noiseless_patient_spider_03_soul_seeking.png`
4. `02_whitman_noiseless_patient_spider_04_bridge.png`

**Agent prompt (two sentences):** Create an immersive boks for Walt Whitman’s “A Noiseless Patient Spider,” using the four images in numerical order with narration and synchronized text. Let the reader drag filaments from the spider and the solitary soul toward distant lights, revealing a luminous bridge after three connections hold.

## Shared implementation notes

- Preserve `cover` positioning and reserve safe zones for synchronized text.
- Use slow parallax and 600–900 ms crossfades; avoid aggressive zooms.
- Respect `prefers-reduced-motion` with static crossfades and tap-only interactions.
- Narration must continue even if the reader does not perform the interaction.
