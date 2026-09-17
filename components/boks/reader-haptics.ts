"use client";

/**
 * A short vibration on the actions that mean something.
 *
 * The original reader used Flutter's `selectionClick` and `mediumImpact`. On
 * the web only `navigator.vibrate` exists, and only on Android - iOS Safari has
 * no equivalent, so this is a quiet enhancement rather than feedback the
 * interface relies on. Every affordance still says what it did visually.
 *
 * Kept deliberately small: 8ms reads as a tick, not a buzz, and a reading app
 * that rattles in the hand is the opposite of the point.
 */

type Haptic = "selection" | "confirm";

const patterns: Record<Haptic, number> = {
  /** Moving on: turning to the next boks. */
  selection: 8,
  /** A deliberate act the reader chose: a like, a follow. */
  confirm: 14,
};

export function haptic(kind: Haptic) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  // Respect a reader who has asked the system for less motion.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  try {
    navigator.vibrate(patterns[kind]);
  } catch {
    // A browser may refuse without a user gesture. Nothing depends on this.
  }
}
