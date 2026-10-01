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

const escapeAfterMs = 6500;

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
      silence();
    };
  }, [moment.kind, moment.loop, silence]);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    silence();
    setLeaving(true);
    // Long enough for the picture to settle before the voice comes back, so the
    // story does not resume over an animation.
    window.setTimeout(onDone, 520);
  }, [onDone, silence]);

  function onPointerDown(event: React.PointerEvent) {
    if (finished.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    if (moment.kind === "swipe") {
      start.current = { x: event.clientX, y: event.clientY };
      return;
    }

    // Hold: a brush of the screen is not a hand on a chest.
    holdTimer.current = window.setTimeout(() => {
      setActive(true);
      paint(1);
      if (!stopLoop.current) stopLoop.current = startInteractionLoop(moment.loop);
    }, moment.activationDelayMs ?? 280);
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
        finish();
        return;
      }
      // Short of it: the crowd closes back in and keeps murmuring.
      paint(0);
      return;
    }

    window.clearTimeout(holdTimer.current);
    silence();
    if (!active) {
      // Never took. Let them try again rather than moving the story on.
      paint(0);
      return;
    }
    setActive(false);
    finish();
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

      <div className="moment__cue">
        <span className="iscene__badge">
          <span className="iscene__badge-dot" aria-hidden="true" />
          {language === "ru" ? "Доступно действие" : "Something to do"}
        </span>
        <span className="moment__hint">{hint}</span>
        <i className="moment__rule" aria-hidden="true" />
      </div>

      {canSkip && !leaving && (
        <button type="button" className="moment__skip" onClick={finish}>
          {language === "ru" ? "Продолжить" : "Continue"}
        </button>
      )}
    </div>
  );
}
