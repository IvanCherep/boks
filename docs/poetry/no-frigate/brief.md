# Emily Dickinson — “There is no Frigate like a Book”

The brief as it arrived with the pictures (`boks_investor_poems.zip`).

1. `04_dickinson_no_frigate_like_a_book_01_book_opens.png`
2. `04_dickinson_no_frigate_like_a_book_02_frigate.png`
3. `04_dickinson_no_frigate_like_a_book_03_coursers.png`
4. `04_dickinson_no_frigate_like_a_book_04_human_soul.png`

**Agent prompt (two sentences):** Create an immersive boks for Emily Dickinson’s “There is no Frigate like a Book,” using the four images in numerical order with narration and seamless page-turn transitions. Let each swipe transform the open book into a frigate and then a chariot, before returning the reader to the room surrounded by the worlds carried by the page.

## Shared implementation notes

- Preserve `cover` positioning and reserve safe zones for synchronized text.
- Use slow parallax and 600–900 ms crossfades; avoid aggressive zooms.
- Respect `prefers-reduced-motion` with static crossfades and tap-only interactions.
- Narration must continue even if the reader does not perform the interaction.
