import { describe, expect, it, vi } from "vitest";
import { canTakeScreen, giveScreenBack, takeScreen, type FullscreenDocument } from "./reading-fullscreen";

function page(overrides: Partial<FullscreenDocument> = {}) {
  const requestFullscreen = vi.fn(() => Promise.resolve());
  const exitFullscreen = vi.fn(() => Promise.resolve());
  const doc: FullscreenDocument = {
    fullscreenEnabled: true,
    fullscreenElement: null,
    exitFullscreen,
    documentElement: { requestFullscreen },
    ...overrides,
  };
  return { doc, requestFullscreen, exitFullscreen };
}

describe("reading fullscreen", () => {
  it("takes the screen on a touch screen that allows it, hiding the navigation", () => {
    const { doc, requestFullscreen } = page();
    expect(takeScreen(doc, true)).toBe(true);
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });
  });

  it("leaves a laptop's window alone", () => {
    const { doc, requestFullscreen } = page();
    expect(takeScreen(doc, false)).toBe(false);
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("does nothing on iPhone Safari, which has no fullscreen for a page", () => {
    expect(canTakeScreen(page({ fullscreenEnabled: false }).doc, true)).toBe(false);
    expect(canTakeScreen(page({ fullscreenEnabled: undefined, documentElement: {} }).doc, true)).toBe(false);
  });

  it("does not claim a screen something else already holds", () => {
    const { doc, requestFullscreen } = page({ fullscreenElement: {} as Element });
    expect(takeScreen(doc, true)).toBe(false);
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("swallows a refusal: the format still opens in the page", async () => {
    const requestFullscreen = vi.fn(() => Promise.reject(new Error("no gesture")));
    const { doc } = page({ documentElement: { requestFullscreen } });
    expect(takeScreen(doc, true)).toBe(true);
    await Promise.resolve();
  });

  it("gives the screen back only while it is held", () => {
    const held = page({ fullscreenElement: {} as Element });
    giveScreenBack(held.doc);
    expect(held.exitFullscreen).toHaveBeenCalledTimes(1);

    // Already left with Back or the system gesture: exiting again would throw.
    const left = page();
    giveScreenBack(left.doc);
    expect(left.exitFullscreen).not.toHaveBeenCalled();
  });
});
