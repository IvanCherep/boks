"use client";

/**
 * Foreground-only reading clock.
 *
 * Time on platform is the metric the product is judged on, so it has to mean
 * "time a person was actually looking at a boks". A plain `Date.now()` delta
 * does not: lock the phone for ten minutes and that is ten minutes of reading.
 *
 * Two rules make this survive real devices:
 *
 * 1. Time only accrues while the page is visible. Visibility is the signal, not
 *    focus - on iOS the comment keyboard fires `blur` while the reader is most
 *    engaged, so focus would stop the clock at exactly the wrong moment.
 * 2. Every accrual is bounded by `maxGapSeconds`. A laptop can suspend without
 *    firing `visibilitychange`, and one bad wake-up would otherwise book a
 *    six-hour read that quietly owns the week's numbers. The caller marks the
 *    clock often enough (a few seconds apart) that ordinary reading never comes
 *    near the bound, so only a suspension is ever clipped.
 *
 * The clock is deliberately DOM-free so it can be tested without a browser.
 * `attachReaderClock` does the wiring.
 */

export type ReaderClock = {
  /**
   * Begin timing a new boks. Discards any time accrued for the previous one,
   * and keeps a paused clock paused: a boks arriving in a hidden tab, or under
   * the series shelf, has not started being read.
   */
  restart: () => void;
  /** Accrue time up to now and keep running. */
  mark: () => void;
  /** Accrue time up to now and stop. */
  pause: () => void;
  /** Start accruing again from now, unless the clock is held. */
  resume: () => void;
  /**
   * Stop and stay stopped until `release`, whatever page visibility does. For
   * a screen in front of the boks - the series shelf - where returning to the
   * tab must not start the clock on a text nobody can see.
   */
  hold: () => void;
  /** End a hold. The clock stays paused; the caller resumes it if visible. */
  release: () => void;
  /**
   * Drop any un-accrued interval and start again from now, without losing what
   * has already accrued. Used when a restored page makes the last timestamp
   * meaningless.
   */
  rebase: () => void;
  activeSeconds: () => number;
  isRunning: () => boolean;
};

export type ReaderClockOptions = {
  now?: () => number;
  /** Longest single un-observed interval that can count as reading. */
  maxGapSeconds?: number;
};

export function createReaderClock(options: ReaderClockOptions = {}): ReaderClock {
  const now = options.now ?? (() => Date.now());
  const maxGapMs = Math.max(1, options.maxGapSeconds ?? 120) * 1000;

  let accruedMs = 0;
  let lastMarkMs: number | null = now();
  let held = false;

  function accrue() {
    if (lastMarkMs === null) return;
    const current = now();
    const delta = current - lastMarkMs;
    lastMarkMs = current;
    if (delta <= 0) return;
    accruedMs += Math.min(delta, maxGapMs);
  }

  return {
    restart() {
      accruedMs = 0;
      if (lastMarkMs !== null) lastMarkMs = now();
    },
    mark: accrue,
    pause() {
      accrue();
      lastMarkMs = null;
    },
    resume() {
      if (!held && lastMarkMs === null) lastMarkMs = now();
    },
    hold() {
      accrue();
      lastMarkMs = null;
      held = true;
    },
    release() {
      held = false;
    },
    rebase() {
      if (!held) lastMarkMs = now();
    },
    activeSeconds() {
      accrue();
      return Math.max(0, Math.round(accruedMs / 1000));
    },
    isRunning: () => lastMarkMs !== null,
  };
}

export type AttachReaderClockOptions = {
  /**
   * How often to fold elapsed time into the total. This is a flush, never a
   * count: the value added is the real elapsed delta, so a throttled timer
   * loses nothing as long as it fires within `maxGapSeconds`.
   */
  markIntervalMs?: number;
};

/** Wires a clock to page visibility. Returns a detach function. */
export function attachReaderClock(clock: ReaderClock, options: AttachReaderClockOptions = {}) {
  if (typeof document === "undefined") return () => undefined;

  const markIntervalMs = options.markIntervalMs ?? 5000;

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") clock.pause();
    else clock.resume();
  };

  // Back/forward cache hands back a page whose last timestamp is arbitrarily
  // old. Rebase instead of accruing the gap.
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) clock.rebase();
    else clock.resume();
  };

  const timer = setInterval(() => {
    if (document.visibilityState === "visible") clock.mark();
  }, markIntervalMs);

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pageshow", onPageShow);

  if (document.visibilityState === "hidden") clock.pause();

  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pageshow", onPageShow);
  };
}
