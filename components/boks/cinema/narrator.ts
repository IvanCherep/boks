"use client";

import type { NarrationLine } from "@/components/boks/cinema/scene-plan";

/**
 * The voice, line by line.
 *
 * The obvious way is to hand the whole boks to `speechSynthesis` and follow
 * the `boundary` events to know where it is. Two things spoil it: Chrome stops
 * a long utterance after about fifteen seconds, and boundary events do not
 * fire at all on iOS - which is most of the readers. So each line is its own
 * utterance and `end` moves to the next one. The line being spoken is then
 * known exactly rather than inferred, which is what the card on screen needs,
 * and no utterance is ever long enough to be cut off.
 *
 * Between lines the position is interpolated from the clock, so the scrubber
 * moves rather than jumping once a sentence.
 */

export type NarratorState = {
  line: number;
  /** Characters into the spoken text, for the progress bar. */
  character: number;
  speaking: boolean;
  done: boolean;
};

export type Narrator = {
  play: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  restart: () => void;
  /** Called on every change worth repainting for. */
  subscribe: (listener: (state: NarratorState) => void) => () => void;
  supported: boolean;
};

export function speechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

/**
 * The best voice for this language that the device happens to have.
 *
 * Voices arrive asynchronously and the list differs on every machine, so this
 * is a preference and never a requirement: with no match the platform default
 * reads it, which is worse but is not silence.
 */
function pickVoice(language: string) {
  if (!speechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  const matching = voices.filter((voice) => voice.lang.toLowerCase().startsWith(language));
  if (!matching.length) return null;
  // A "local" voice does not need the network, so it starts immediately and
  // keeps working on a train.
  const preferred = matching.find((voice) => voice.localService && /natural|enhanced|premium/i.test(voice.name));
  return preferred ?? matching.find((voice) => voice.localService) ?? matching[0];
}

export function createNarrator(input: {
  lines: readonly NarrationLine[];
  language: string;
  charactersPerSecond: number;
}): Narrator {
  const listeners = new Set<(state: NarratorState) => void>();
  const totalCharacters = input.lines.length ? input.lines[input.lines.length - 1].end : 0;

  let line = 0;
  let speaking = false;
  let done = false;
  let lineStartedAt = 0;
  let frame: number | null = null;
  // Set while we stop the voice on purpose, so the `end` event that follows is
  // not mistaken for a line finishing on its own and does not advance.
  /**
   * Bumped by every stop. Each utterance and each timer remembers the number
   * it was born under and does nothing once that number has moved on.
   *
   * A boolean here did not work, and the way it failed is worth keeping: it
   * was raised, `speechSynthesis.cancel()` was called, and it was lowered
   * again on the same line - but `cancel()` delivers its `end` events on a
   * later tick, by which time the flag said "not cancelling", so the handler
   * dutifully started the next line. Closing the window left the voice reading
   * the story to an empty screen.
   */
  let generation = 0;
  let silentTimer: number | null = null;
  /**
   * Set when the platform claims a speech API but has no voice behind it - a
   * headless browser, a stripped Linux, a Chrome without the language pack.
   * Every utterance then fails the moment it is handed over, and following
   * `error` to the next line raced through a six-minute story in seconds.
   * After the first such failure the clock takes over instead.
   */
  let voiceless = false;

  const state = (): NarratorState => {
    const current = input.lines[Math.min(line, input.lines.length - 1)];
    if (!current) return { line: 0, character: 0, speaking, done };
    const elapsed = speaking && lineStartedAt ? (performance.now() - lineStartedAt) / 1000 : 0;
    const within = Math.min(current.end - current.start, elapsed * input.charactersPerSecond);
    return {
      line,
      character: Math.min(totalCharacters, current.start + within),
      speaking,
      done,
    };
  };

  const emit = () => {
    const snapshot = state();
    listeners.forEach((listener) => listener(snapshot));
  };

  const tick = () => {
    emit();
    frame = speaking ? requestAnimationFrame(tick) : null;
  };

  const startTicking = () => {
    if (frame === null) frame = requestAnimationFrame(tick);
  };

  const stopTicking = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };

  function speakLine(index: number) {
    if (index >= input.lines.length) {
      speaking = false;
      done = true;
      stopTicking();
      emit();
      return;
    }

    line = index;

    // No voice on this browser - the pictures and the words still run, on the
    // clock. A prototype shown on the wrong laptop should be quiet, not blank.
    if (!speechSupported() || voiceless) {
      const mine = generation;
      const seconds = (input.lines[index].end - input.lines[index].start) / input.charactersPerSecond;
      lineStartedAt = performance.now();
      speaking = true;
      startTicking();
      emit();
      silentTimer = window.setTimeout(() => {
        silentTimer = null;
        if (mine === generation) speakLine(index + 1);
      }, Math.max(900, seconds * 1000));
      return;
    }

    // Cleared until the voice actually starts, so the position is not computed
    // from the previous line's clock while this one is still being handed over.
    lineStartedAt = 0;

    const utterance = new SpeechSynthesisUtterance(input.lines[index].text.replace(/\n/g, " "));
    utterance.lang = input.language === "ru" ? "ru-RU" : "en-US";
    const voice = pickVoice(input.language);
    if (voice) utterance.voice = voice;
    // Slightly under a newsreader. These are short literary pieces; the point
    // is to be read to, not to be briefed.
    utterance.rate = 0.96;
    utterance.pitch = 1;

    const mine = generation;
    let started = false;
    utterance.onstart = () => {
      if (mine !== generation) return;
      started = true;
      lineStartedAt = performance.now();
      speaking = true;
      startTicking();
      emit();
    };
    utterance.onend = () => {
      if (mine !== generation) return;
      speakLine(index + 1);
    };
    utterance.onerror = () => {
      if (mine !== generation) return;
      if (!started) {
        // It never got as far as speaking, so there is no voice here. Reading
        // that as "this line is finished" is how a story ran to its end in the
        // time it takes to read one card.
        voiceless = true;
        speakLine(index);
        return;
      }
      // A voice that gives up part way through one line should not end the
      // story; the next line usually speaks.
      speakLine(index + 1);
    };

    window.speechSynthesis.speak(utterance);
  }

  function hardStop() {
    // Everything already scheduled belongs to a past life from here on.
    generation += 1;
    if (silentTimer !== null) {
      window.clearTimeout(silentTimer);
      silentTimer = null;
    }
    if (speechSupported()) window.speechSynthesis.cancel();
  }

  return {
    supported: speechSupported(),
    play() {
      hardStop();
      done = false;
      speaking = true;
      speakLine(line);
      emit();
    },
    pause() {
      // `pause()` is unreliable on several platforms - it is ignored outright
      // on iOS and resumes on its own in some Chrome versions. Cancelling and
      // re-speaking the current line from its start is a hair less smooth and
      // always does what the button says.
      hardStop();
      speaking = false;
      stopTicking();
      emit();
    },
    resume() {
      speaking = true;
      speakLine(line);
      emit();
    },
    stop() {
      hardStop();
      speaking = false;
      stopTicking();
      listeners.clear();
    },
    restart() {
      hardStop();
      line = 0;
      done = false;
      speaking = true;
      speakLine(0);
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state());
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Voices load asynchronously and the first call often returns nothing. Asking
 * once at mount means the first tap already has a voice to choose from.
 */
export function primeVoices() {
  if (!speechSupported()) return;
  window.speechSynthesis.getVoices();
}
