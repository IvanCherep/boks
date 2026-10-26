/**
 * Study b1's yoke: what an active participant's hand did in an immersive
 * poem, so a passive participant can be shown exactly the same.
 *
 * Each sample is keyed to the recording's own clock, not the wall clock, so
 * the replay lands every press, drag and release at the same moment of the
 * reading whatever the passive participant's device is doing. Positions are
 * fractions of the poem's surface, so a different screen size still draws the
 * same gesture over the same part of the picture.
 *
 * What it cannot keep: a gesture made while the reading was paused. The
 * recording's clock stands still, so the replay puts all of it at one moment.
 * The trace says how much of it there was (`pausedSamples`), and the analysis
 * can leave out a pair where that matters.
 */

export type GestureSampleKind = "down" | "move" | "up" | "cancel";

/** `[recording ms, kind, x 0..1, y 0..1]` */
export type GestureSample = [number, GestureSampleKind, number, number];

export type GestureTrace = {
  version: 1;
  /** The recording's length, to check a replay is of the same take. */
  durationMs: number;
  samples: GestureSample[];
  /** Samples taken while the reading was paused. */
  pausedSamples: number;
};

/** Moves closer together than this are dropped; a drag stays smooth at ~30 per second. */
export const traceMoveIntervalMs = 33;
/** Enough for several minutes of continuous dragging, and under the database's size cap. */
export const traceSampleLimit = 4000;

export function createTraceRecorder(durationMs: number) {
  const samples: GestureSample[] = [];
  let pausedSamples = 0;
  let lastMoveAt = -Infinity;
  return {
    add(kind: GestureSampleKind, mediaMs: number, x: number, y: number, options: { now: number; paused: boolean }) {
      if (samples.length >= traceSampleLimit) return;
      if (kind === "move") {
        if (options.now - lastMoveAt < traceMoveIntervalMs) return;
        lastMoveAt = options.now;
      }
      if (options.paused) pausedSamples += 1;
      samples.push([Math.round(mediaMs), kind, round(clamp01(x)), round(clamp01(y))]);
    },
    get size() {
      return samples.length;
    },
    trace(): GestureTrace {
      return { version: 1, durationMs, samples: [...samples], pausedSamples };
    },
  };
}

/**
 * The replay's cursor: which samples fall due as the recording's clock moves
 * from `fromMs` to `toMs`. A jump backwards (a seek) starts again from the
 * first sample after the new position; `released` then says a press was
 * still down and has to be let go.
 */
export function dueSamples(trace: GestureTrace, cursor: number, fromMs: number, toMs: number) {
  if (toMs < fromMs) {
    const next = trace.samples.findIndex((sample) => sample[0] > toMs);
    return { due: [] as GestureSample[], cursor: next < 0 ? trace.samples.length : next, released: true };
  }
  const due: GestureSample[] = [];
  let index = cursor;
  while (index < trace.samples.length && trace.samples[index][0] <= toMs) {
    due.push(trace.samples[index]);
    index += 1;
  }
  return { due, cursor: index, released: false };
}

export function isGestureTrace(value: unknown): value is GestureTrace {
  if (!value || typeof value !== "object") return false;
  const trace = value as Partial<GestureTrace>;
  return trace.version === 1 && Array.isArray(trace.samples) && typeof trace.durationMs === "number";
}

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
