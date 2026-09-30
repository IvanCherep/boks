/**
 * The illustration behind a boks.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ PLACEHOLDER. One picture, shown for every boks in the catalogue.        │
 * │ Replace it, and this file is the only place that has to change.         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * The prototype is asking whether a story worth looking at holds a reader
 * better than a story that is only worth reading, and a single good picture
 * answers that as well as five hundred would - so nothing is generated, stored
 * or paid for yet. What it cannot show is a picture that belongs to *this*
 * piece, which is the whole point of the eventual thing, and that is why the
 * screen says so out loud rather than letting a demonstration imply otherwise.
 *
 * When real art arrives, `sceneImageFor` is the seam: give it the boks and it
 * returns a URL and whether that URL is still the stand-in. Everything else -
 * the cover, the reading, the ending, the badge - already reads the answer.
 *
 * Until then the drawn scene in `scene-art.tsx` stays underneath: it is what
 * is seen while this loads, and what is seen if it ever fails to.
 */

export const placeholderSceneImage = "/cinema/placeholder-scene.jpg";

export type SceneImage = {
  src: string;
  /** True while this is the one picture everything shares. */
  placeholder: boolean;
};

// The argument is the seam, and it is unused on purpose: every boks gets the
// same picture until there is real art to give it a different one.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function sceneImageFor(storyId: string): SceneImage {
  return { src: placeholderSceneImage, placeholder: true };
}

/**
 * One picture across six scenes would be six identical frames, so each scene
 * takes a different part of it and a slightly different light. The picture is
 * tall, so there is room to move down it without ever hitting an edge.
 */
export function sceneImageFraming(scene: number, sceneCount: number) {
  const span = Math.max(1, sceneCount - 1);
  const position = sceneCount <= 1 ? 50 : 22 + (scene / span) * 56;
  // Dusk to deep night and back towards light, as the drawn palettes do.
  const warmth = [1.06, 0.98, 0.92, 0.88, 0.95, 1.04][scene % 6];
  return {
    objectPosition: `50% ${position.toFixed(1)}%`,
    filter: `brightness(${warmth}) saturate(${(0.92 + (scene % 3) * 0.06).toFixed(2)})`,
    scale: 1.04 + (scene % 3) * 0.03,
  };
}
