/**
 * The browser out of the way while a poem or the cinema plays.
 *
 * A reading format is a picture with words in it, and an address bar under the
 * picture is the one thing on screen that is not part of it. Where the page is
 * allowed to, opening a format takes the whole screen and closing it gives the
 * screen back.
 *
 * Where it is allowed to: Android browsers and iPad. iPhone Safari has no
 * fullscreen for anything but a <video>, so there `fullscreenEnabled` is false
 * and this does nothing - an iPhone reader gets the browser out of the way by
 * opening boks from the home screen (see `home-screen-hint.ts`).
 *
 * Only on a touch screen. On a laptop the window is the reader's own
 * arrangement, and a page that takes over the monitor uninvited is rude.
 *
 * The reader is never stranded: the system shows its own "swipe to exit"
 * when fullscreen starts, Back leaves it, and the player's close button
 * leaves it along with the player.
 */

type FullscreenTarget = {
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
};

export type FullscreenDocument = {
  fullscreenEnabled?: boolean;
  fullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void>;
  documentElement: FullscreenTarget;
};

function coarsePointer() {
  try {
    return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

export function canTakeScreen(doc: FullscreenDocument, touchScreen: boolean) {
  return (
    touchScreen &&
    doc.fullscreenEnabled === true &&
    !doc.fullscreenElement &&
    typeof doc.documentElement.requestFullscreen === "function"
  );
}

/**
 * Asks for the whole screen. Must run while the tap that opened the format is
 * still fresh - browsers refuse fullscreen that no gesture asked for. Returns
 * whether it asked, so the caller knows the screen is its to give back.
 */
export function takeScreen(
  doc: FullscreenDocument | undefined = typeof document === "undefined" ? undefined : document,
  touchScreen = coarsePointer()
) {
  if (!doc || !canTakeScreen(doc, touchScreen)) return false;
  // A refusal (no gesture, a policy, an in-app browser) leaves the format in
  // the page as it always was. Nothing to tell the reader.
  doc.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
  return true;
}

/** Gives the screen back, if anything still holds it. */
export function giveScreenBack(
  doc: FullscreenDocument | undefined = typeof document === "undefined" ? undefined : document
) {
  if (!doc?.fullscreenElement || typeof doc.exitFullscreen !== "function") return;
  doc.exitFullscreen().catch(() => {});
}
