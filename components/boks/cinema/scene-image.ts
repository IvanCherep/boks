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
 * `sceneImageFor` is the seam: give it the boks and the scene, and it returns
 * a URL and whether that URL is still the stand-in. Everything else -
 * the cover, the reading, the ending, the badge - already reads the answer.
 *
 * Until then the drawn scene in `scene-art.tsx` stays underneath: it is what
 * is seen while this loads, and what is seen if it ever fails to.
 */

export const placeholderSceneImage = "/cinema/placeholder-scene.jpg";

/**
 * Boks that have art of their own, one picture per scene.
 *
 * One entry so far - Tolstoy's "Лев и собачка" - and it is what the stand-in
 * exists to be replaced by: six pictures made for these six turns of this
 * story, in one style, in the order the story takes them.
 */
const sceneArt: Record<string, readonly string[]> = {
  // Лев Толстой — Лев и собачка
  "ee470590-a93c-467e-aaeb-87ae00c0745e": [
    "/cinema/lion/scenes/1.jpg",
    "/cinema/lion/scenes/2.jpg",
    "/cinema/lion/scenes/3.jpg",
    "/cinema/lion/scenes/4.jpg",
    "/cinema/lion/scenes/5.jpg",
    "/cinema/lion/scenes/6.jpg",
  ],
};

/** Every boks with art of its own - for the series shelf's test. */
export const storiesWithSceneArt: readonly string[] = Object.keys(sceneArt);

export type SceneImage = {
  src: string;
  /** True while this is the one picture everything shares. */
  placeholder: boolean;
};

export function sceneImageFor(storyId: string, scene: number): SceneImage {
  const art = sceneArt[storyId];
  if (art?.length) {
    // Past the last picture, the last one holds rather than falling back to the
    // stand-in mid-story.
    return { src: art[Math.min(scene, art.length - 1)], placeholder: false };
  }
  return { src: placeholderSceneImage, placeholder: true };
}

/** Every picture this boks will need, for warming them before they are shown. */
export function sceneImagesFor(storyId: string): readonly string[] {
  return sceneArt[storyId] ?? [];
}

/**
 * One picture across six scenes would be six identical frames, so each scene
 * takes a different part of it and a slightly different light. The picture is
 * tall, so there is room to move down it without ever hitting an edge.
 *
 * Only for the stand-in. Art made for a scene is shown as it was composed -
 * cropping and tinting someone\u2019s painting to fake variety would be worse
 * than the variety is worth.
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
