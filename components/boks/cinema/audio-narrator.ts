"use client";

import { lineAtTime } from "@/components/boks/cinema/narration-track";
import type { Narrator, NarratorState } from "@/components/boks/cinema/narrator";

/**
 * The same narrator, driven by a recording instead of the browser's voice.
 *
 * It exists to answer the question the prototype is actually asking. The
 * browser voice is free and says the words, but it is a robot reading Tolstoy,
 * and nobody shown that can tell whether they were unmoved by the format or by
 * the voice. A real reading removes the doubt.
 *
 * It is also more honest about where it is. The speech version infers the
 * position from a reading rate and the highlight drifts across a long
 * paragraph; here the line comes from the recording's own per-character
 * timings, so the words light up exactly when they are said.
 */
export function createAudioNarrator(input: {
  audioUrl: string;
  /** When each line begins, in seconds. See `lineStartTimes`. */
  lineStarts: readonly number[];
  /** Used until the file has loaded and can say its own length. */
  estimatedSeconds: number;
}): Narrator {
  const listeners = new Set<(state: NarratorState) => void>();
  const audio = typeof Audio === "undefined" ? null : new Audio(input.audioUrl);
  if (audio) {
    audio.preload = "auto";
  }

  let frame: number | null = null;
  let done = false;

  const state = (): NarratorState => {
    const seconds = audio?.currentTime ?? 0;
    const total = audio && Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : input.estimatedSeconds;
    return {
      line: lineAtTime(input.lineStarts, seconds),
      elapsedSeconds: Math.min(total, seconds),
      totalSeconds: total,
      speaking: Boolean(audio && !audio.paused && !audio.ended),
      done,
    };
  };

  const emit = () => {
    const snapshot = state();
    listeners.forEach((listener) => listener(snapshot));
  };

  const tick = () => {
    emit();
    frame = audio && !audio.paused && !audio.ended ? requestAnimationFrame(tick) : null;
  };

  const startTicking = () => {
    if (frame === null) frame = requestAnimationFrame(tick);
  };

  const stopTicking = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };

  audio?.addEventListener("ended", () => {
    done = true;
    stopTicking();
    emit();
  });
  // Without this the clock reads the estimate until the first frame plays.
  audio?.addEventListener("loadedmetadata", emit);

  function start(from: number) {
    if (!audio) return;
    done = false;
    audio.currentTime = from;
    // Blocked autoplay is the one failure worth surviving: the reader pressed a
    // button, so it should not happen, and if it does the screen must not sit
    // there pretending to play.
    void audio.play().then(startTicking, () => {
      stopTicking();
      emit();
    });
    emit();
  }

  return {
    supported: Boolean(audio),
    play() {
      start(0);
    },
    pause() {
      audio?.pause();
      stopTicking();
      emit();
    },
    resume() {
      if (!audio) return;
      void audio.play().then(startTicking, () => emit());
      emit();
    },
    stop() {
      stopTicking();
      if (audio) {
        audio.pause();
        // Frees the download as well as the sound; closing the window should
        // leave nothing running.
        audio.src = "";
      }
      listeners.clear();
    },
    restart() {
      start(0);
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state());
      return () => listeners.delete(listener);
    },
  };
}
