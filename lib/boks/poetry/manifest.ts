/**
 * An immersive poem, as data.
 *
 * The renderer knows nothing about any particular poem: lines, timings, images,
 * safe zones and effects all arrive from a manifest, so a second poem is assets
 * and JSON rather than a second component.
 *
 * Everything here is pure and derived from one number - the position in the
 * recording. That is the whole design: `audio.currentTime` is the only clock.
 * A chain of timers would survive neither a pause, nor a seek, nor a
 * backgrounded tab, and the state for any moment has to be computable in one
 * frame from that moment alone.
 */

export type SafeZone = {
  /** Named when a line is deliberately split between two parts of the frame. */
  role?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PoemScene = {
  id: string;
  line: string;
  image: string;
  /** When this scene takes over, in the recording. */
  startMs: number;
  /** How many of the poem's lines it carries. One unless it says otherwise. */
  lines?: number;
  focalPoint: { x: number; y: number };
  safeZones: SafeZone[];
  textPreset: string;
  transitionMs: number;
};

export type PoemToken = {
  text: string;
  atMs: number;
  endMs: number;
  zone?: string;
  /**
   * Which phrase this word belongs to, counting across the whole poem.
   *
   * Words are lit by phrase rather than one at a time: a single word going out
   * as the next comes on happens thirty-three times in this poem and reads as
   * flicker however accurately it is timed.
   */
  phrase?: number;
  /**
   * The word that carries the line - the one closing a phrase.
   *
   * Fixed in the data rather than decided while rendering, because a word that
   * changes size changes the layout of its neighbours, and doing that as each
   * word is spoken shakes the whole screen.
   */
  emphasis?: "lead";
};

export type PoemLine = {
  sceneId: string;
  startMs: number;
  endMs: number;
  tokens: PoemToken[];
};

export type PoemManifest = {
  id: string;
  title: string;
  author: string;
  language: string;
  /**
   * Where the word times came from. `forced-alignment` means they are the ones
   * the recording actually returned; anything else means they are guesses and
   * the words will drift against the voice.
   */
  timingMode: "forced-alignment" | "placeholder";
  audio: string;
  /**
   * The piece's own theme, played with the voice and locked to it.
   *
   * Not background music and not optional: it is part of the reading, so it
   * follows every pause, seek and rate change the narration makes.
   */
  theme?: { src: string; gain: number };
  durationMs: number;
  palette: { text: string; active: string; shadow: string };
  playback: {
    /** How early a word begins arriving, so it is whole when it is spoken. */
    tokenLeadMs?: number;
    /**
     * How long after a line begins the picture starts to change.
     *
     * Positive: the word lands first and the scene turns under it. Changing
     * both on the same beat is what makes a short poem feel cut.
     */
    crossfadeOffsetMs: number;
    defaultCrossfadeMs: number;
    backgroundScaleFrom: number;
    backgroundScaleTo: number;
  };
  scenes: PoemScene[];
  lines: PoemLine[];
};

/** The effects the renderer can draw. Anything else falls back to `quiet-breath`. */
export const textPresets = [
  "farewell-drift",
  "social-hierarchy-split",
  "uniform-formation",
  "quiet-breath",
  "ridge-reveal",
  "shelter-reveal",
  "searchlight-scan",
  "echo-fade",
] as const;

export type TextPreset = (typeof textPresets)[number];

const fallbackPreset: TextPreset = "quiet-breath";

/**
 * A preset the renderer has no CSS for would otherwise be an unstyled line of
 * text in the middle of a composed frame. The quiet one is the safe default:
 * it only fades, so it is never wrong, only plain.
 */
export function presetFor(scene: Pick<PoemScene, "textPreset">): TextPreset {
  return (textPresets as readonly string[]).includes(scene.textPreset)
    ? (scene.textPreset as TextPreset)
    : fallbackPreset;
}

/**
 * Which line owns the screen at this moment.
 *
 * Lines are contiguous - each runs until the next begins - so there is always
 * an answer, including before the first word and after the last. Returns an
 * index rather than the line so a caller can look ahead to the next one.
 */
export function lineIndexAt(lines: readonly PoemLine[], ms: number): number {
  if (lines.length === 0) return -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (ms >= lines[index].startMs) return index;
  }
  return 0;
}

/** The picture a line is spoken over. A scene may serve several lines. */
export function sceneFor(manifest: PoemManifest, lineIndex: number): PoemScene | null {
  const line = manifest.lines[lineIndex];
  if (!line) return null;
  return manifest.scenes.find((scene) => scene.id === line.sceneId) ?? null;
}

/** A picture by its own index, which is what the backdrop deals in. */
export function sceneAt(manifest: PoemManifest, sceneIndex: number): PoemScene | null {
  return manifest.scenes[sceneIndex] ?? null;
}

export type TokenState = "hidden" | "active" | "settled";

/**
 * Where a word is in its life, at this moment.
 *
 * Exactly one word in a line is active at a time: a word becomes active when it
 * is spoken and hands over when the next one is. The last word of a line keeps
 * it until the line ends, so a line never finishes on a dimmed word.
 *
 * `settled` is not `gone`. A spoken word stays on screen - that is what makes
 * this a poem assembling itself rather than karaoke.
 */
export function tokenStateAt(line: PoemLine, index: number, ms: number): TokenState {
  const token = line.tokens[index];
  if (!token || ms < token.atMs) return "hidden";

  /*
   * Lit until its phrase is done, not until the next word is spoken.
   *
   * Words still arrive one at a time, with the voice - that is the format. But
   * a word that dims the moment the next one speaks makes the line blink its
   * way across the screen. Inside a phrase the light only grows; it goes out
   * once, when the phrase does.
   */
  const phrase = token.phrase;
  if (phrase === undefined) {
    const next = line.tokens[index + 1];
    return ms < (next ? next.atMs : line.endMs) ? "active" : "settled";
  }
  const after = line.tokens.find((other) => (other.phrase ?? -1) > phrase);
  return ms < (after ? after.atMs : line.endMs) ? "active" : "settled";
}

/**
 * The word the reading has reached, as an index into the line.
 *
 * The last word that has begun by `ms` - not the last one that is "active".
 * The renderer reads ahead of the voice by `tokenLeadMs`, so in the final
 * fraction of a second of every line `ms` runs past the line's end, every
 * word in it is settled, and asking for the active one found none and fell
 * back to the first. Everything after the line's first phrase went out for
 * a frame or two and came back - a blink at the end of every line, measured
 * at full opacity to zero and back. The word reached cannot go backwards.
 */
export function wordReachedAt(line: PoemLine, ms: number): number {
  let reached = 0;
  for (let index = 0; index < line.tokens.length; index += 1) {
    if (line.tokens[index].atMs <= ms) reached = index;
  }
  return reached;
}

/**
 * The zone a token belongs in.
 *
 * A token names a role only where a line is deliberately split across the
 * frame - "страна рабов" low, "страна господ" high. Everything else takes the
 * first zone, and a role that does not exist in this scene falls back to it
 * rather than placing the word at the origin.
 */
export function zoneFor(scene: PoemScene, role?: string): SafeZone {
  if (role) {
    const named = scene.safeZones.find((zone) => zone.role === role);
    if (named) return named;
  }
  return scene.safeZones[0] ?? { x: 0.08, y: 0.1, width: 0.84, height: 0.3 };
}

/**
 * Has the crossfade to the next scene begun?
 *
 * It starts before the line does, by `crossfadeLeadMs`, so the new picture is
 * arriving as the first word is spoken rather than after it.
 */
export function crossfadeProgress(
  lines: readonly PoemLine[],
  lineIndex: number,
  ms: number,
  offsetMs: number,
  transitionMs: number
): number {
  const next = lines[lineIndex + 1];
  if (!next || transitionMs <= 0) return 0;
  const begins = next.startMs + offsetMs;
  if (ms <= begins) return 0;
  return Math.min(1, (ms - begins) / transitionMs);
}

/**
 * The two pictures on screen, and how far between them.
 *
 * This is deliberately not "the scene for the current line". A crossfade starts
 * before the next line and lasts longer than that lead, so it is still running
 * after the line has changed. Swapping the layers when the line changes would
 * cut the dissolve in half and show as a jump - the new picture snapping from
 * part-faded to solid on the very frame the first word arrives.
 *
 * So the backdrop has its own clock: the pair is held until the dissolve has
 * actually finished, whatever the words are doing.
 */
export function backdropAt(
  manifest: PoemManifest,
  ms: number
): { from: number; to: number; progress: number } {
  const offset = manifest.playback.crossfadeOffsetMs;
  /*
   * Walked over scenes, not over lines.
   *
   * A picture can carry more than one line - eight of them across seventeen
   * seconds changed too fast to settle into any - so scene boundaries are not
   * line boundaries, and asking a line which picture it wants would try to
   * dissolve an image into itself between the two halves of a pair.
   *
   * What is on screen is the last picture whose dissolve has finished, which
   * is also not the picture belonging to the line being spoken: a line begins,
   * its first word arrives, and for `offset` milliseconds the frame is still
   * the one before.
   */
  let settled = 0;
  for (let index = 1; index < manifest.scenes.length; index += 1) {
    const scene = manifest.scenes[index];
    const span = scene.transitionMs || manifest.playback.defaultCrossfadeMs;
    const begins = scene.startMs + offset;
    if (ms >= begins + span) {
      settled = index;
      continue;
    }
    if (ms >= begins) {
      return { from: index - 1, to: index, progress: (ms - begins) / span };
    }
    break;
  }
  // Indexes rather than scenes, so the renderer can give each one a layer of
  // its own and never change the picture on a layer that is being looked at.
  return { from: settled, to: -1, progress: 0 };
}

/**
 * Where "back" lands.
 *
 * The same rule a music player uses, because it is the one people already
 * have: part-way into a line, go to the start of that line; right at its
 * beginning, go to the one before. Without the grace period a reader tapping
 * back twice would get the same line twice and conclude the control is broken.
 */
export function previousLineStart(
  lines: readonly PoemLine[],
  ms: number,
  graceMs = 400
): number {
  const index = lineIndexAt(lines, ms);
  if (index <= 0) return 0;
  const line = lines[index];
  if (ms - line.startMs > graceMs) return line.startMs;
  return lines[index - 1].startMs;
}

/** Where "forward" lands: the next line, or the end of the poem. */
export function nextLineStart(
  lines: readonly PoemLine[],
  ms: number,
  durationMs: number
): number {
  const next = lines[lineIndexAt(lines, ms) + 1];
  return next ? next.startMs : durationMs;
}

/** How far through the whole piece, for the progress bar. */
export function playedFraction(ms: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, ms / durationMs));
}
