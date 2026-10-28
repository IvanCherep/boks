/**
 * Something to read to.
 *
 * One track for the whole catalogue, not a score per piece. A theme written
 * for a particular story has to come out of that story, and generating one per
 * boks produces music that is about nothing - we tried it. This is the other
 * thing entirely: a room tone for silent reading, the same for every boks,
 * which is why it can be good rather than merely appropriate.
 *
 * Off until asked for, always. Music that starts on its own is hostile, and a
 * browser would refuse it anyway. The choice is remembered, so it is asked
 * once.
 *
 * It plays only under reading. The cinema has a voice of its own, and this
 * stops before that starts.
 */

const track = "/reading-music.mp3";

/**
 * Three decibels under the narration's own level.
 *
 * Not matched to it, under it: speech is half pauses, so continuous music at
 * the same measured level reads as louder. The track arrives at -16.8 dBFS and
 * the reading voice sits at -21.4, which makes this the number that puts them
 * where a listener would call them equal.
 */
const level = 0.42;

const preferenceKey = "boks-reading-music";

export function readingMusicWanted() {
  try {
    return window.localStorage.getItem(preferenceKey) === "on";
  } catch {
    return false;
  }
}

function remember(wanted: boolean) {
  try {
    window.localStorage.setItem(preferenceKey, wanted ? "on" : "off");
  } catch {
    // Storage off: the choice holds for this sitting and no longer.
  }
}

let element: HTMLAudioElement | null = null;
let fade = 0;

function rideTo(target: number, ms: number, thenPause: boolean) {
  const audio = element;
  if (!audio) return;
  if (fade) window.clearInterval(fade);
  const from = audio.volume;
  const started = performance.now();
  // Stepped on a timer: an audio element has no automation, and 40ms is well
  // under what an ear hears as a staircase.
  fade = window.setInterval(() => {
    const t = Math.min(1, (performance.now() - started) / ms);
    audio.volume = Math.max(0, Math.min(1, from + (target - from) * t));
    if (t < 1) return;
    window.clearInterval(fade);
    fade = 0;
    if (thenPause) audio.pause();
  }, 40);
}

/**
 * Start it. Must be called from a gesture the first time. `keep` false plays
 * it without remembering the choice: a study's music block is not the
 * reader's preference.
 */
export function startReadingMusic(keep = true) {
  if (typeof window === "undefined") return;
  if (!element) {
    element = new window.Audio(track);
    element.loop = true;
    element.preload = "none";
  }
  element.volume = 0;
  void element.play().catch(() => {
    // Refused, or no network for it. Reading is unaffected.
  });
  rideTo(level, 900, false);
  if (keep) remember(true);
}

/** Stop it, with `forget` false when something else is only borrowing silence. */
export function stopReadingMusic(forget = true) {
  if (forget) remember(false);
  if (!element) return;
  rideTo(0, 500, true);
}

export function readingMusicPlaying() {
  return Boolean(element && !element.paused);
}
