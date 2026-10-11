# Boks Series — “Binsey Poplars” interaction brief

## Goal

Build a reusable four-scene poetry experience for Gerard Manley Hopkins’s “Binsey Poplars”. The emotional arc is: living landscape → tactile connection → irreversible absence → memory.

This implementation must use the existing generic Boks Series player and reusable declarative scene events. Do not hard-code poem-specific React components.

## Assets

- `01-living-landscape.png` — the complete living row of poplars.
- `02-leaves-and-light.png` — closer view for the touch-and-hold interaction.
- `03-felled-landscape.png` — same riverbank after the trees have been felled.
- `04-memory-landscape.png` — empty bank with subtle remembered silhouettes.

All assets are vertical backgrounds without embedded text. Use `object-fit: cover`; preserve the center and left-bank composition. Keep UI text inside safe areas and verify on narrow mobile screens.

## Reusable event types required

1. `scene` — set the active background with a configurable crossfade duration.
2. `hold_ambient` — while the user holds the screen, increase a looping ambient sound and apply subtle parallax to the current scene.
3. `release_transition` — on release, stop the ambient loop and transition to another scene.
4. `word_cue` — show synchronized words or short phrases at normalized screen coordinates.
5. `memory_overlay` — dissolve from a real landscape into a memory-state image.

Implement these events through JSON/config so they can be reused by other poems.

## Experience timeline

### Scene 1 — Living landscape

- Background: `01-living-landscape.png`.
- Start narration and soft river/wind ambience.
- Apply only slow camera drift: scale `1.00 → 1.025` over 12–16 seconds.
- Show synchronized text in the lower safe area.

### Scene 2 — Touch the poplars

- Crossfade to `02-leaves-and-light.png` over 1.2 seconds.
- Display a small prompt: `Touch and hold to hear the poplars`.
- The prompt must fade after the first successful hold.
- While held:
  - raise leaf/wind ambience from 0.25 to 0.75 over 600 ms;
  - apply parallax of no more than 8 px;
  - add a subtle moving dapple-light overlay;
  - never pause narration.
- On release, return ambience to 0.25 over 500 ms.

### Scene 3 — All felled

- At the first occurrence of “All felled”, freeze parallax immediately.
- Fade the leaf ambience to silence over 250–350 ms.
- Crossfade to `03-felled-landscape.png` over 900 ms.
- Do not add an axe animation or ask the user to cut the trees.
- Leave 500–700 ms of near-silence after the visual change, without interrupting narration timing.

### Scene 4 — Memory

- On the final section beginning with “After-comers”, dissolve to `04-memory-landscape.png` over 1.8–2.2 seconds.
- Restore only quiet river ambience; do not restore the leaf loop.
- Use a slow 1% zoom and very subtle mist movement.
- Hold the final frame for 2.5 seconds after narration ends before showing the end card.

## Accessibility and controls

- The poem must remain fully understandable without interacting.
- Respect `prefers-reduced-motion`; replace parallax and zoom with simple crossfades.
- Add a sound toggle and visible captions.
- Touch target covers the stage but must not block close, play/pause, seek, or accessibility controls.
- Support pointer, touch, and keyboard: Space/Enter should activate the hold state while pressed.
- Do not require haptics; use a short optional haptic only when supported and previously enabled.

## Analytics

Record pseudonymous events:

- `scene_enter` with `scene_id`;
- `interaction_prompt_shown`;
- `hold_start`, `hold_end`, and `hold_duration_ms`;
- `release_transition_completed`;
- `poem_complete`;
- `exit` with playback position;
- `reduced_motion_enabled`;
- `captions_enabled` and `sound_enabled`.

Do not treat interaction as required for completion. Preserve reader-level aggregation for research analysis.

## Acceptance criteria

- Background transitions remain smooth on a mid-range mobile device.
- No layout shift when text cues appear.
- Audio continues without gaps except for the intentionally faded leaf ambience.
- Controls remain usable during every interaction.
- The same event renderer can load a second poem from config without new component code.
- A no-interaction control variant can be enabled with a single configuration flag for the research experiment.
