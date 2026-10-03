/**
 * What this device remembers about the series shelf: which pieces were heard
 * to the end, and which the reader has already seen on the shelf.
 *
 * Browser storage on purpose, and only for these two conveniences - a check on
 * a card and the "new" dot on the tab. Neither is a measurement. Whether a
 * piece was finished, liked or answered is recorded where every reading is,
 * through the reader's events; this only decides what to draw. Losing it (a
 * private window, cleared storage) costs a check mark and nothing else.
 */

const heardKey = "boks-series-heard";
const seenKey = "boks-series-seen";

function readIds(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function writeIds(key: string, ids: ReadonlySet<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Not remembered this time; nothing depends on it.
  }
}

export function readHeardSeries() {
  return readIds(heardKey);
}

/** Marks a piece heard. Returns the new set. */
export function rememberHeardSeries(storyId: string) {
  const heard = readIds(heardKey);
  heard.add(storyId);
  writeIds(heardKey, heard);
  return heard;
}

export function readSeenSeries() {
  return readIds(seenKey);
}

export function rememberSeenSeries(storyIds: readonly string[]) {
  const seen = readIds(seenKey);
  for (const id of storyIds) seen.add(id);
  writeIds(seenKey, seen);
}

/**
 * Whether the tab has something the reader has not looked at. A piece added
 * next month lights the dot again for a reader who has visited before.
 */
export function hasUnseenSeries(storyIds: readonly string[], seen: ReadonlySet<string>) {
  return storyIds.some((id) => !seen.has(id));
}
