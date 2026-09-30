import { describe, expect, it } from "vitest";
import { sceneImageFor, sceneImagesFor } from "@/components/boks/cinema/scene-image";

const lion = "ee470590-a93c-467e-aaeb-87ae00c0745e";

describe("which scenes carry a painting of their own", () => {
  // `placeholder` is not only a label. It is the branch that decides whether
  // the drawn city is built at all: around 270 SVG nodes, an infinite drift
  // and a fractal-noise grain over 400x800, two of them alive during a
  // dissolve. Behind a real painting all of it is covered by an opaque
  // full-bleed image, so it is drawn for nobody. If this flag ever goes true
  // for a boks that has art, that cost comes back and the dissolve stutters.
  it("marks every scene of the lion as painted", () => {
    const images = sceneImagesFor(lion);
    expect(images.length).toBe(6);
    for (let scene = 0; scene < images.length; scene += 1) {
      expect(sceneImageFor(lion, scene).placeholder).toBe(false);
    }
  });

  it("holds the last painting rather than falling back mid-story", () => {
    // The scene planner can run past the last picture on a long final scene.
    // Dropping to the shared stand-in there would be visible and wrong.
    const last = sceneImageFor(lion, 5);
    expect(sceneImageFor(lion, 6)).toEqual(last);
    expect(sceneImageFor(lion, 99)).toEqual(last);
  });

  it("still asks for the drawn scene where there is no art", () => {
    // Every other boks: the drawn city is the whole picture, so it must keep
    // being built.
    expect(sceneImageFor("any-other-boks", 0).placeholder).toBe(true);
    expect(sceneImagesFor("any-other-boks")).toHaveLength(0);
  });
});
