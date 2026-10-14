# Lord Byron — “Napoleon’s Farewell”

A public-domain poem first published in 1815. The 24-line text is suitable for approximately 90–120 seconds of expressive narration.

## Image order

1. `01_waterloo_and_memory_of_glory.png` — Napoleon after Waterloo; his coronation and conquests survive only as a vision in the storm.
2. `02_farewell_to_france.png` — the defeated emperor looks back at the French coast from a departing ship.
3. `03_old_guard_and_fallen_eagle.png` — exhausted veterans lower the imperial eagle while Napoleon stands apart.
4. `04_saint_helena_and_violet.png` — exile on Saint Helena; the violet from the final stanza grows between volcanic rocks.

## Two-sentence agent prompt

Create an immersive boks for Lord Byron’s “Napoleon’s Farewell,” using the four images in numerical order with restrained dramatic narration, synchronized text, slow parallax, and cinematic crossfades. Let the reader press and hold to reveal warm fragments of Napoleon’s former glory within the storm clouds; when released, they dissolve back into defeat and exile, ending on the violet at Saint Helena.

## Implementation notes

- Keep the text separate from the images and synchronize it to narration by line or couplet.
- The interaction must be optional: narration and scene progression continue if the reader does nothing.
- Use one reusable hold/release overlay effect rather than custom code for every frame.
- Respect `prefers-reduced-motion` by replacing parallax with static crossfades.
- Source text: `napoleons_farewell_text.txt`.

