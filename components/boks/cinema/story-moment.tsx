"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { dragProgress, snapTarget } from "@/lib/boks/interactions/scenes";
import { startInteractionLoop } from "@/lib/boks/interactions/sound";
import type { StoryMoment } from "@/components/boks/cinema/story-moments";

/**
 * A moment inside a story: the narration stops, something is heard, and it
 * only goes on once the reader has done the thing.
 *
 * This is not the sandbox component. The sandbox exists to judge mechanics side
 * by side and wears the chrome for it - a reset button, a verdict, a frame
 * counter. Here the mechanic has to disappear into the story: no way back, no
 * score, and the only way out is forward. What the two genuinely share is the
 * part worth sharing - `dragProgress` and `snapTarget`, the pure gesture maths
 * - and the cue language, so a reader who met a swipe once meets the same swipe
 * again.
 *
 * The sound runs for as long as the situation does. A crowd murmurs until it is
 * pushed aside; a heart beats while a finger stays on it. Both are stopped on
 * every exit, including unmount, because a heartbeat still going under the next
 * paragraph would be a horrible thing to ship.
 */

const escapeAfterMs = 9000;

/**
 * Once a hold takes, it keeps going for this long whatever the finger does.
 *
 * A press and an immediate release used to show the second picture and take it
 * away inside a few hundred milliseconds - long enough to register that
 * something flickered, nowhere near long enough to hear a heart or to work out
 * that holding was the thing that did it. At around a beat a second this is
 * four beats, which is the point where it stops being a noise and becomes a
 * heart. Releasing after that ends it immediately: nobody is held hostage,
 * they are only stopped from missing it.
 */
const minimumListenMs = 4000;

/** How long the result stays up, in silence, before the story resumes. */
const dwellAfterSwipeMs = 1700;
const dwellAfterHoldMs = 900;

export function StoryMomentScene({
  moment,
  language,
  onDone,
}: {
  moment: StoryMoment;
  language: "ru" | "en";
  onDone: () => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const stopLoop = useRef<(() => void) | null>(null);
  const holdTimer = useRef(0);
  const finished = useRef(false);

  const activatedAt = useRef(0);
  const releaseTimer = useRef(0);
  const [active, setActive] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [canSkip, setCanSkip] = useState(false);

  const paint = useCallback((value: number) => {
    frame.current?.style.setProperty("--p", value.toFixed(4));
  }, []);

  const silence = useCallback(() => {
    stopLoop.current?.();
    stopLoop.current = null;
  }, []);

  // A reader who cannot make the gesture - a stiff hand, a dead touchscreen, a
  // child with the phone upside down - must never be locked inside a story.
  useEffect(() => {
    const timer = window.setTimeout(() => setCanSkip(true), escapeAfterMs);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    // The crowd is heard the moment the narration stops; the heart only when a
    // finger is on it, which is the whole gesture.
    if (moment.kind === "swipe") stopLoop.current = startInteractionLoop(moment.loop);
    return () => {
      window.clearTimeout(holdTimer.current);
      window.clearTimeout(releaseTimer.current);
      silence();
    };
  }, [moment.kind, moment.loop, silence]);

  /**
   * End the moment: sound away, result held, then back to the story.
   *
   * The dwell is the part that was missing. The crowd has gone, the picture is
   * finally clear, and the reader is given time to look at it in silence before
   * the voice returns - which is what makes having moved them feel like it did
   * something. Resuming the instant the gesture lands throws that away, and
   * leaves someone who tapped by accident with no idea what happened.
   */
  const finish = useCallback(
    (dwellMs: number) => {
      if (finished.current) return;
      finished.current = true;
      window.clearTimeout(releaseTimer.current);
      // The sound does not stop, it dies away: about four tenths of a second.
      silence();
      window.setTimeout(() => {
        setLeaving(true);
        window.setTimeout(onDone, 950);
      }, dwellMs);
    },
    [onDone, silence]
  );

  /** The hold is over: let the heart fade, hold the picture, then go on. */
  const endHold = useCallback(() => {
    setActive(false);
    finish(dwellAfterHoldMs);
  }, [finish]);

  function onPointerDown(event: React.PointerEvent) {
    if (finished.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    if (moment.kind === "swipe") {
      start.current = { x: event.clientX, y: event.clientY };
      return;
    }

    // Pressed again while it was finishing by itself: they want to keep
    // listening, so take the ending back.
    if (releaseTimer.current) {
      window.clearTimeout(releaseTimer.current);
      releaseTimer.current = 0;
      return;
    }

    // Hold: a brush of the screen is not a hand on a chest.
    holdTimer.current = window.setTimeout(() => {
      setActive(true);
      paint(1);
      activatedAt.current = performance.now();
      if (!stopLoop.current) stopLoop.current = startInteractionLoop(moment.loop);
    }, moment.activationDelayMs ?? 350);
  }

  function onPointerMove(event: React.PointerEvent) {
    if (finished.current || moment.kind !== "swipe" || !start.current) return;
    paint(
      dragProgress(start.current, { x: event.clientX, y: event.clientY }, {
        axis: "x",
        distancePx: moment.distancePx,
      })
    );
  }

  function onPointerUp(event: React.PointerEvent) {
    if (finished.current) return;

    if (moment.kind === "swipe") {
      if (!start.current) return;
      const progress = dragProgress(
        start.current,
        { x: event.clientX, y: event.clientY },
        { axis: "x", distancePx: moment.distancePx }
      );
      start.current = null;
      if (snapTarget(progress, moment.snapThreshold) === 1) {
        paint(1);
        finish(dwellAfterSwipeMs);
        return;
      }
      // Short of it: the crowd closes back in and keeps murmuring.
      paint(0);
      return;
    }

    window.clearTimeout(holdTimer.current);
    if (!active) {
      // Never took. Let them try again rather than moving the story on, and
      // leave the sound alone - there is none yet.
      paint(0);
      return;
    }

    // Lifted early: the heart keeps going until it has been a heart.
    const held = performance.now() - activatedAt.current;
    const remaining = Math.max(0, minimumListenMs - held);
    if (remaining > 0) {
      releaseTimer.current = window.setTimeout(() => {
        releaseTimer.current = 0;
        endHold();
      }, remaining);
      return;
    }
    endHold();
  }

  const hint = moment.hint[language];

  return (
    <div
      ref={frame}
      className={`moment moment--${moment.kind} ${active ? "is-active" : ""} ${leaving ? "is-leaving" : ""}`}
      style={{ "--p": "0" } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="moment__layer moment__after" src={moment.after} alt="" draggable={false} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="moment__layer moment__before" src={moment.before} alt="" draggable={false} />

      {/*
        Shown where the gesture happens, not only written at the bottom. A
        swipe gets a hand that keeps making the swipe; a hold gets a ring on
        the chest that keeps closing. Words say what, the demonstration says
        how, and between them nothing is left to work out.
      */}
      {moment.hotspot && (
        <div
          className="moment__gesture"
          aria-hidden="true"
          style={{ left: `${moment.hotspot.x * 100}%`, top: `${moment.hotspot.y * 100}%` }}
        >
          {moment.kind === "swipe" ? (
            <>
              <span className="moment__trail" />
              <span className="moment__finger" />
            </>
          ) : (
            <>
              <span className="moment__press" />
              <span className="moment__press" />
              <span className="moment__finger moment__finger--still" />
            </>
          )}
        </div>
      )}

      <div className="moment__cue">
        <span className="iscene__badge">
          <span className="iscene__badge-dot" aria-hidden="true" />
          {language === "ru" ? "Доступно действие" : "Something to do"}
        </span>
        <span className="moment__hint">{hint}</span>
        <span className="moment__how">{moment.how[language]}</span>
        <i className="moment__rule" aria-hidden="true" />
      </div>

      {canSkip && !leaving && (
        <button type="button" className="moment__skip" onClick={() => finish(0)}>
          {language === "ru" ? "Продолжить" : "Continue"}
        </button>
      )}
    </div>
  );
}
