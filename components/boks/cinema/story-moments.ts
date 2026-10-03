import type { LoopProfile } from "@/lib/boks/interactions/sound";

/**
 * Places where a story stops and asks something of the reader.
 *
 * A moment is not an illustration with a button on it. It is a hole cut in the
 * narration at a line that can carry the weight of a pause, and the gesture has
 * to be the thing the sentence is about - otherwise it is a quiz between
 * paragraphs and the reader learns to resent it.
 *
 * Two rules decided the placements below, and both are worth keeping for the
 * next story:
 *
 * - Never at the opening or the close. The beginning has not earned a pause and
 *   the ending must not be interrupted by anything at all.
 * - Far apart. Two in quick succession turn a story into a sequence of tasks.
 */

export type StoryMoment = {
  id: string;
  /** Where the recording stops, in seconds. */
  atSeconds: number;
  kind: "swipe" | "hold";
  before: string;
  after: string;
  /**
   * Two lines, not one.
   *
   * The short one names what will happen; the long one says which fingers to
   * move and where. A single clever imperative reads well and leaves the reader
   * guessing, and a reader who is guessing has stopped being inside the story.
   */
  hint: { ru: string; en: string };
  how: { ru: string; en: string };
  /** Where to point, as a fraction of the frame. The whole frame still works. */
  hotspot?: { x: number; y: number };
  /** What is heard while the story waits. */
  loop: LoopProfile;
  /** Swipe: travel that completes it, and how far counts as committed. */
  distancePx?: number;
  snapThreshold?: number;
  /** Hold: how long before the sound starts, so a brush of the screen is not it. */
  activationDelayMs?: number;
};

const lionMoments: StoryMoment[] = [
  /*
   * 50.6s - straight after "собачка легла подле него и положила свою голову
   * ему на лапу".
   *
   * The picture is the pair asleep, seen past the top hats of people who have
   * come to gawp at them. That is the whole point of putting it here: the
   * tenderest line in the story is the one a crowd would queue to stare at, and
   * the reader gets to push them out of the way.
   */
  {
    id: "crowd",
    atSeconds: 50.6,
    kind: "swipe",
    before: "/cinema/lion/moments/crowd/before.webp",
    after: "/cinema/lion/moments/crowd/after.webp",
    hint: { ru: "Раздвиньте толпу", en: "Part the crowd" },
    how: {
      ru: "Проведите пальцем вправо",
      en: "Swipe to the right",
    },
    hotspot: { x: 0.5, y: 0.72 },
    loop: "crowd",
    distancePx: 170,
    snapThreshold: 0.45,
  },
  /*
   * 78.8s - after "Так прожили лев и собачка целый год в одной клетке", and
   * immediately before "Через год собачка заболела и издохла".
   *
   * The reader holds a finger on a living chest, feels it beating, lets go -
   * and the next sentence kills her. The placement is the effect; anywhere else
   * this is a nice animation.
   */
  {
    id: "heartbeat",
    atSeconds: 78.8,
    kind: "hold",
    before: "/cinema/lion/moments/heartbeat/before.webp",
    after: "/cinema/lion/moments/heartbeat/after.webp",
    hint: { ru: "Послушайте сердце", en: "Listen to his heart" },
    how: {
      ru: "Нажмите и держите палец на груди льва",
      en: "Press and hold on the lion's chest",
    },
    // His chest, left of the sleeping puppy. Pressing anywhere works - the cue
    // points, it does not fence.
    hotspot: { x: 0.33, y: 0.6 },
    loop: "heartbeat",
    activationDelayMs: 280,
  },
];

const moments: Record<string, readonly StoryMoment[]> = {
  // Лев Толстой — Лев и собачка
  "ee470590-a93c-467e-aaeb-87ae00c0745e": lionMoments,
};

export function storyMomentsFor(storyId: string): readonly StoryMoment[] {
  return moments[storyId] ?? [];
}

/**
 * How late a moment may still open, in seconds.
 *
 * Playback reports often enough that crossing the mark is always caught inside
 * this. Seeking is the case it exists for: a reader who drags past a moment has
 * skipped it, and having it ambush them several lines later would be worse than
 * never showing it.
 */
export const momentGraceSeconds = 4;

/**
 * Moments the playhead is now behind, which should be available again.
 *
 * Someone who missed one, or liked it, should be able to drag back and have it
 * happen: there is nothing here to protect, and refusing would make the mark on
 * the bar a liar. Stated as a rule about where the playhead is rather than by
 * watching for a jump, so it holds for a scrub, a fifteen-second button and a
 * replay alike.
 */
export function momentsToRearm(
  all: readonly StoryMoment[],
  elapsedSeconds: number
): string[] {
  return all
    .filter((moment) => elapsedSeconds + momentGraceSeconds < moment.atSeconds)
    .map((moment) => moment.id);
}

/** The moment that should open now, if any. */
export function momentDueAt(
  all: readonly StoryMoment[],
  elapsedSeconds: number,
  done: ReadonlySet<string>
): StoryMoment | null {
  for (const moment of all) {
    if (done.has(moment.id)) continue;
    if (elapsedSeconds < moment.atSeconds) continue;
    if (elapsedSeconds > moment.atSeconds + momentGraceSeconds) continue;
    return moment;
  }
  return null;
}
