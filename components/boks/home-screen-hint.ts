/**
 * The one way an iPhone reader gets boks without a browser around it.
 *
 * iPhone Safari gives a page no fullscreen (`reading-fullscreen.ts` does
 * nothing there), but a site added to the home screen opens as an app of its
 * own, with no address bar and no toolbar. Nobody finds that menu by
 * themselves, so it is said once - at the end of a poem or a story read
 * aloud, the moment the toolbar under the picture was most in the way - and
 * never again.
 *
 * Only where it can be done: an iPhone or iPad, in a browser tab rather than
 * already from the home screen, and not inside another app's web view, whose
 * share menu has no such item.
 */

export const homeScreenHintKey = "boks-home-screen-hint";

export type DeviceFacts = {
  userAgent: string;
  /** iPadOS reports itself as a Mac; touch points are what give it away. */
  maxTouchPoints: number;
  /** Already opened from the home screen. */
  standalone: boolean;
};

type HintStorage = Pick<Storage, "getItem" | "setItem">;

const inAppBrowser = /FBAN|FBAV|Instagram|Line\/|Telegram|Twitter|LinkedInApp|GSA\//;

export function canAddToHomeScreen(device: DeviceFacts) {
  if (device.standalone) return false;
  if (inAppBrowser.test(device.userAgent)) return false;
  const apple = /iPhone|iPad|iPod/.test(device.userAgent);
  const iPadAsMac = /Macintosh/.test(device.userAgent) && device.maxTouchPoints > 1;
  return apple || iPadAsMac;
}

function defaultStorage(): HintStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function currentDevice(): DeviceFacts | null {
  if (typeof navigator === "undefined" || typeof window === "undefined") return null;
  let standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  try {
    standalone ||= window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    // An old browser without matchMedia is not a home-screen app either.
  }
  return { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints ?? 0, standalone };
}

/** Whether to say it now. Reads only; `markHomeScreenHintShown` remembers. */
export function shouldOfferHomeScreen(
  device: DeviceFacts | null = currentDevice(),
  storage: HintStorage | null = defaultStorage()
) {
  if (!device || !storage || !canAddToHomeScreen(device)) return false;
  try {
    return storage.getItem(homeScreenHintKey) !== "shown";
  } catch {
    // Storage refused: it could not be remembered either, and a hint at
    // every ending is worse than none.
    return false;
  }
}

export function markHomeScreenHintShown(storage: HintStorage | null = defaultStorage()) {
  try {
    storage?.setItem(homeScreenHintKey, "shown");
  } catch {
    // Private mode: it may be said once more next visit.
  }
}
