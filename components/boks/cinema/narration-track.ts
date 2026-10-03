import type { NarrationLine } from "@/components/boks/cinema/scene-plan";

/**
 * A boks that has been read by a real voice, and where the recording is.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ One entry so far: Tolstoy's "Лев и собачка", read by ElevenLabs.        │
 * │ Everything else falls back to the browser's own voice.                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * The recording comes with per-character timings, which is the whole reason to
 * use one. The browser's speech API cannot say where in a sentence it is - the
 * prototype infers it from a reading rate, and the highlight drifts. With an
 * alignment the highlight is not an estimate: it is where the voice actually
 * is, to the character.
 *
 * Adding a boks here is two files and one line. Whether that scales to five
 * hundred is a question about money, not about this file - see the costing.
 */

export type NarrationTrack = {
  /**
   * Audio served from our own origin; the policy allows no other.
   *
   * MP3, deliberately. The same reading as AAC in an .m4a was a third smaller
   * and played perfectly from its own address - but fed to a media element as
   * a blob it failed to decode at all, `MEDIA_ERR_SRC_NOT_SUPPORTED`, and the
   * blob is not optional: it is what makes the recording seekable when the
   * server will not answer a range request. MP3 decodes everywhere, from
   * anywhere.
   */
  audio: string;
  /** Per-character timings for the same text. */
  alignment: string;
};

const tracks: Record<string, NarrationTrack> = {
  // Лев Толстой — Лев и собачка
  // Read by Alex Bell (eleven_v4), the Russian voice this catalogue casts for
  // a male author - see `components/boks/cinema/voices.ts`. The alignment is
  // the one that reading returned, so it has to be replaced with the audio.
  "ee470590-a93c-467e-aaeb-87ae00c0745e": {
    audio: "/cinema/lion/narration.mp3",
    alignment: "/cinema/lion/alignment.json",
  },
};

export function narrationTrackFor(storyId: string): NarrationTrack | null {
  return tracks[storyId] ?? null;
}

export type NarrationAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

/**
 * When each line starts, in the recording.
 *
 * The text handed to the voice and the text cut into lines are the same words
 * with different whitespace - the lines dropped the paragraph breaks and added
 * their own. So both are walked ignoring whitespace, which lines them up
 * character for character; measured on the Tolstoy piece, 1510 on each side,
 * identical.
 *
 * Returns null rather than a wrong answer if they ever stop matching: a
 * highlight in the wrong place is worse than no recording at all, and the
 * caller falls back to the browser voice.
 */
export function lineStartTimes(
  lines: readonly NarrationLine[],
  alignment: NarrationAlignment
): number[] | null {
  const spokenIndexes: number[] = [];
  for (let index = 0; index < alignment.characters.length; index += 1) {
    if (!/\s/.test(alignment.characters[index])) spokenIndexes.push(index);
  }

  const fromLines = lines.map((line) => line.text).join(" ").replace(/\s+/g, "");
  if (fromLines.length !== spokenIndexes.length) return null;

  const starts: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    const at = spokenIndexes[Math.min(cursor, spokenIndexes.length - 1)];
    starts.push(alignment.character_start_times_seconds[at] ?? 0);
    cursor += line.text.replace(/\s+/g, "").length;
  }
  return starts;
}

/** Which line the recording is inside at this moment. */
export function lineAtTime(lineStarts: readonly number[], seconds: number) {
  for (let index = lineStarts.length - 1; index >= 0; index -= 1) {
    if (seconds >= lineStarts[index]) return index;
  }
  return 0;
}
