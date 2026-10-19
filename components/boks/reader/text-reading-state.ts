export type TextReadingPhase = "cover" | "reading" | "finale";

/** Bounds of only the HTML text, relative to its scroll viewport. Decorations
 * and the ending never add scroll distance to the measurement. */
export function textReadingState({ top, height, viewport, inset = 80 }: {
  top: number; height: number; viewport: number; inset?: number;
}): { phase: TextReadingPhase; progress: number; scrollable: boolean } {
  const available = Math.max(1, viewport - inset);
  const scrollable = height > available;
  if (top >= viewport || height <= 0) return { phase: "cover", progress: 0, scrollable };
  if (top + height <= inset) return { phase: "finale", progress: 1, scrollable };
  const progress = scrollable
    ? Math.min(1, Math.max(0, (inset - top) / Math.max(1, height - available)))
    : (top >= inset ? 0 : 1);
  return { phase: "reading", progress, scrollable };
}
