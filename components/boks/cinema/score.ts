import { unlockInteractionSound } from "@/lib/boks/interactions/sound";

/**
 * The music under a boks.
 *
 * Worth saying plainly, because it is the question that was asked: this is not
 * part of generating the voice. Text to speech returns speech. Music is a
 * second recording that we lay under it and mix ourselves, which means every
 * decision about it is ours - including whether to have any.
 *
 * It is easy to do badly. Music under a short literary piece can tell the
 * reader how to feel about a sentence before they have finished hearing it, and
 * Tolstoy does not need the help. So the rules here are narrow:
 *
 * - It sits twenty decibels under the voice, which is where broadcast puts a
 *   bed under dialogue. Measured, not chosen by ear.
 * - It gets out of the way in the frequencies speech lives in, rather than only
 *   being quiet. A pad at the same level but spread across 1-3 kHz muddies
 *   consonants; a dip there buys clarity that turning it down cannot.
 * - It comes up only where the voice is not: under a moment, when the narration
 *   has stopped anyway.
 * - It can be switched off, and that choice is remembered. Some readers simply
 *   do not want music over a story, and they are not wrong.
 */

const scores: Record<string, string> = {
  // Лев Толстой — Лев и собачка
  "ee470590-a93c-467e-aaeb-87ae00c0745e": "/cinema/lion/score.mp3",
};

export function scoreFor(storyId: string): string | null {
  return scores[storyId] ?? null;
}

/**
 * Levels, as gains against the file as it was generated (-18.5 dBFS), with the
 * narration's own active level (-21.4 dBFS) as the reference. Both numbers are
 * measured, and both have to be re-measured whenever either recording changes.
 */
export const scoreLevels = {
  /** Under the reading: 20 dB down, the middle of where broadcast puts a bed. */
  under: 0.072,
  /** While a moment holds the story, with nothing else to compete with. */
  open: 0.18,
};

const preferenceKey = "boks-cinema-score";

export function scoreWanted() {
  try {
    return window.localStorage.getItem(preferenceKey) !== "off";
  } catch {
    return true;
  }
}

export function rememberScoreWanted(wanted: boolean) {
  try {
    window.localStorage.setItem(preferenceKey, wanted ? "on" : "off");
  } catch {
    // Storage off: the choice holds for this sitting and no longer.
  }
}

export type ScoreBed = {
  /** Ride to a level over a number of seconds. */
  to: (gain: number, seconds?: number) => void;
  stop: () => void;
};

/**
 * Start the bed. Returns null when there is no music for this boks, when the
 * reader has turned it off, or when the browser will not give us audio.
 */
export function startScore(storyId: string): ScoreBed | null {
  if (typeof window === "undefined") return null;
  const src = scoreFor(storyId);
  if (!src || !scoreWanted()) return null;

  const ctx = unlockInteractionSound();
  if (!ctx) return null;

  const element = new window.Audio(src);
  element.loop = true;
  element.preload = "auto";

  const source = ctx.createMediaElementSource(element);

  /*
   * A dip where speech is, not a blanket turn-down.
   *
   * Consonants - the part of a voice that carries the words rather than the
   * tone - sit between one and three kilohertz. A pad spread across that range
   * blurs them even at a level that measures as quiet, so it is pulled down
   * there specifically and left alone everywhere else, which keeps the warmth
   * and gives back the words.
   */
  const outOfTheWay = ctx.createBiquadFilter();
  outOfTheWay.type = "peaking";
  outOfTheWay.frequency.value = 2000;
  outOfTheWay.Q.value = 0.8;
  outOfTheWay.gain.value = -7;

  const volume = ctx.createGain();
  volume.gain.value = 0;

  source.connect(outOfTheWay);
  outOfTheWay.connect(volume);
  volume.connect(ctx.destination);

  void element.play().catch(() => {
    // Refused: the story is fine without it.
  });

  let stopped = false;
  return {
    to(gain, seconds = 1.2) {
      if (stopped) return;
      volume.gain.cancelScheduledValues(ctx.currentTime);
      volume.gain.setTargetAtTime(gain, ctx.currentTime, Math.max(0.05, seconds / 3));
    },
    stop() {
      if (stopped) return;
      stopped = true;
      volume.gain.cancelScheduledValues(ctx.currentTime);
      volume.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      window.setTimeout(() => {
        element.pause();
        try {
          source.disconnect();
          outOfTheWay.disconnect();
          volume.disconnect();
        } catch {
          // Already torn down.
        }
      }, 1600);
    },
  };
}
