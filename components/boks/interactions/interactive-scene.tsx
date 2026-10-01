"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  affordanceFor,
  brushCells,
  clearedFraction,
  dragCueAngle,
  dragProgress,
  initialProgressFor,
  sceneAssets,
  sliderProgress,
  snapTarget,
  type InteractionScene,
} from "@/lib/boks/interactions/scenes";
import {
  playInteractionSound,
  shouldRepeat,
  unlockInteractionSound,
} from "@/lib/boks/interactions/sound";

/**
 * One engine for every interactive scene.
 *
 * The thing that decides whether this feels expensive or cheap is not the
 * mechanic, it is the latency, so the rule here is that nothing a finger does
 * goes through React. Pointer movement writes CSS custom properties straight
 * onto the frame inside one animation frame, and the layers are styled off
 * those properties. React state changes only when something discrete happens:
 * the pictures arrived, the gesture latched, the reader finished.
 *
 * A `setState` per `pointermove` at 120 Hz is the usual reason an effect like
 * this stutters, and it is invisible in the code that causes it.
 */

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Progress over time, on rAF, cancellable. One tween at a time per scene. */
function createTween() {
  let raf = 0;
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  const run = (from: number, to: number, ms: number, onFrame: (v: number) => void, onDone?: () => void) => {
    stop();
    if (ms <= 0) {
      onFrame(to);
      onDone?.();
      return;
    }
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / ms);
      onFrame(from + (to - from) * easeOut(t));
      if (t < 1) {
        raf = requestAnimationFrame(step);
        return;
      }
      raf = 0;
      onDone?.();
    };
    raf = requestAnimationFrame(step);
  };
  return { run, stop };
}

type Status = "loading" | "ready" | "failed";

export function InteractiveScene({
  scene,
  onCompleted,
  className,
}: {
  scene: InteractionScene;
  onCompleted?: () => void;
  className?: string;
}) {
  const assets = sceneAssets(scene.id);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const beforeImage = useRef<HTMLImageElement | null>(null);

  const [status, setStatus] = useState<Status>("loading");
  const [engaged, setEngaged] = useState(false);
  const [completed, setCompleted] = useState(false);

  const progress = useRef(initialProgressFor(scene));
  const tween = useRef(createTween());
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const holdTimer = useRef(0);
  const springTimer = useRef(0);
  const lastBrush = useRef<{ x: number; y: number } | null>(null);
  const lastSoundAt = useRef(0);
  const cells = useRef<boolean[]>([]);
  const reducedMotion = useRef(false);

  const isMaskBrush = scene.primitive === "mask" && scene.brushRadiusPx !== undefined;
  const isMaskRadial = scene.primitive === "mask" && !isMaskBrush;

  /** The only place progress reaches the DOM. */
  const paint = useCallback((value: number) => {
    progress.current = value;
    frame.current?.style.setProperty("--p", value.toFixed(4));
  }, []);

  const markCompleted = useCallback(() => {
    setCompleted((already) => {
      if (!already) onCompleted?.();
      return true;
    });
  }, [onCompleted]);

  // Decode both pictures before the scene is live. Half a scene is worse than
  // a still: the reader presses, nothing moves, and they decide it is broken.
  useEffect(() => {
    let cancelled = false;
    reducedMotion.current =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const load = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(src));
        image.src = src;
      });

    Promise.all([load(assets.before), load(assets.after)])
      .then(async ([before, after]) => {
        await Promise.all([before.decode?.().catch(() => {}), after.decode?.().catch(() => {})]);
        if (cancelled) return;
        beforeImage.current = before;
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [assets.before, assets.after]);

  useEffect(() => {
    const currentTween = tween.current;
    return () => {
      currentTween.stop();
      window.clearTimeout(holdTimer.current);
      window.clearTimeout(springTimer.current);
    };
  }, []);

  // The frost layer: the picture painted into a canvas, to be rubbed off.
  const paintFrost = useCallback(() => {
    const element = canvas.current;
    const image = beforeImage.current;
    if (!element || !image) return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // Capped at 2: a third device pixel costs real fill rate on a phone and
    // buys nothing visible through frost.
    const scale = Math.min(2, window.devicePixelRatio || 1);
    element.width = Math.round(rect.width * scale);
    element.height = Math.round(rect.height * scale);
    const ctx = element.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    // `cover`, by hand, so the canvas frames the picture exactly as the <img>
    // beneath it does and the two cannot drift apart.
    const ratio = Math.max(rect.width / image.width, rect.height / image.height);
    const drawWidth = image.width * ratio;
    const drawHeight = image.height * ratio;
    ctx.drawImage(image, (rect.width - drawWidth) / 2, (rect.height - drawHeight) / 2, drawWidth, drawHeight);
    const columns = 24;
    const rows = Math.max(1, Math.round((columns * rect.height) / rect.width));
    cells.current = new Array(columns * rows).fill(false);
  }, []);

  useEffect(() => {
    if (status !== "ready" || !isMaskBrush) return;
    paintFrost();
    const onResize = () => paintFrost();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [status, isMaskBrush, paintFrost]);

  function localPoint(event: React.PointerEvent) {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  function rub(x: number, y: number) {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const rect = element.getBoundingClientRect();
    const radius = scene.brushRadiusPx ?? 56;

    ctx.globalCompositeOperation = "destination-out";
    const from = lastBrush.current;
    if (from) {
      // Join to the previous point, or a fast swipe leaves gaps between dots.
      ctx.lineWidth = radius * 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    lastBrush.current = { x, y };

    const columns = 24;
    const rows = Math.max(1, Math.round((columns * rect.height) / rect.width));
    for (const index of brushCells(x, y, radius, {
      columns,
      rows,
      width: rect.width,
      height: rect.height,
    })) {
      cells.current[index] = true;
    }
    if (clearedFraction(cells.current) >= (scene.completionThreshold ?? 0.55)) markCompleted();
  }

  function onPointerDown(event: React.PointerEvent) {
    if (status !== "ready") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    // A browser will not give out an AudioContext that nobody asked for, and
    // sound that starts on its own is a bug. So it is unlocked here, inside a
    // real gesture, and never before one.
    unlockInteractionSound();
    setEngaged(true);
    const point = localPoint(event);

    if (scene.primitive === "toggle") {
      const springs = (scene.holdMs ?? 0) > 0;
      if (springs) {
        window.clearTimeout(springTimer.current);
        playInteractionSound(scene.sound);
        tween.current.run(progress.current, 1, scene.enterMs ?? 200, paint, () => {
          markCompleted();
          springTimer.current = window.setTimeout(
            () => tween.current.run(1, 0, scene.exitMs ?? 500, paint),
            scene.holdMs ?? 300
          );
        });
        return;
      }
      const target = progress.current > 0.5 ? 0 : 1;
      // Only going on makes a sound. A lamp switched off is quiet.
      if (target === 1) playInteractionSound(scene.sound);
      tween.current.run(
        progress.current,
        target,
        (target === 1 ? scene.enterMs : scene.exitMs) ?? 450,
        paint,
        () => target === 1 && markCompleted()
      );
      return;
    }

    if (scene.primitive === "hold") {
      const start = () => {
        playInteractionSound(scene.sound);
        tween.current.run(progress.current, 1, scene.enterMs ?? 350, paint, markCompleted);
      };
      if (scene.activationDelayMs) {
        holdTimer.current = window.setTimeout(start, scene.activationDelayMs);
        return;
      }
      start();
      return;
    }

    if (scene.primitive === "slider") {
      paint(sliderProgress(point.x, point.width));
      return;
    }

    if (scene.primitive === "drag") {
      dragStart.current = { x: point.x, y: point.y };
      return;
    }

    if (isMaskBrush) {
      lastBrush.current = null;
      rub(point.x, point.y);
      return;
    }

    if (isMaskRadial) {
      frame.current?.style.setProperty("--mx", `${point.x}px`);
      frame.current?.style.setProperty("--my", `${point.y}px`);
      playInteractionSound(scene.sound);
      paint(1);
      markCompleted();
    }
  }

  function onPointerMove(event: React.PointerEvent) {
    if (status !== "ready" || !engaged) return;
    const point = localPoint(event);

    if (scene.primitive === "slider") {
      const next = sliderProgress(point.x, point.width);
      // A tick every so often, not one per pointer event: a good screen sends
      // over a hundred a second and they would arrive as a buzz.
      if (Math.abs(next - progress.current) > 0.004 && shouldRepeat(lastSoundAt.current, performance.now(), 90)) {
        lastSoundAt.current = performance.now();
        playInteractionSound(scene.sound);
      }
      paint(next);
      return;
    }
    if (scene.primitive === "drag" && dragStart.current) {
      paint(dragProgress(dragStart.current, point, scene));
      return;
    }
    if (isMaskBrush) {
      if (shouldRepeat(lastSoundAt.current, performance.now(), 110)) {
        lastSoundAt.current = performance.now();
        playInteractionSound(scene.sound);
      }
      rub(point.x, point.y);
      return;
    }
    if (isMaskRadial) {
      frame.current?.style.setProperty("--mx", `${point.x}px`);
      frame.current?.style.setProperty("--my", `${point.y}px`);
    }
  }

  function onPointerUp() {
    if (status !== "ready") return;
    setEngaged(false);
    window.clearTimeout(holdTimer.current);
    lastBrush.current = null;

    if (scene.primitive === "hold") {
      tween.current.run(progress.current, 0, scene.exitMs ?? 500, paint);
      return;
    }
    if (scene.primitive === "drag") {
      const target = snapTarget(progress.current, scene.snapThreshold);
      // The sound belongs to the thing opening, so it waits for the latch
      // rather than firing on a swipe that falls back.
      if (target === 1) playInteractionSound(scene.sound);
      tween.current.run(progress.current, target, 320, paint, () => target === 1 && markCompleted());
      dragStart.current = null;
      return;
    }
    if (isMaskRadial) {
      tween.current.run(progress.current, 0, 420, paint);
    }
  }

  function reset() {
    tween.current.stop();
    window.clearTimeout(holdTimer.current);
    window.clearTimeout(springTimer.current);
    dragStart.current = null;
    lastBrush.current = null;
    setCompleted(false);
    setEngaged(false);
    paint(initialProgressFor(scene));
    if (isMaskBrush) paintFrost();
  }

  const affordance = affordanceFor(scene);
  const mode =
    scene.primitive === "slider"
      ? "seam"
      : scene.id === "reveal-ink"
        ? "wipe"
        : isMaskRadial
          ? "radial"
          : isMaskBrush
            ? "brush"
            : "fade";

  // Only gestures that travel need the browser to stop scrolling for them. A
  // tap or a hold must not take the page's scroll away on touch-down.
  const capturesScroll =
    scene.primitive === "drag" || scene.primitive === "slider" || scene.primitive === "mask";

  return (
    <div
      ref={frame}
      className={`iscene iscene--${mode} ${engaged ? "is-engaged" : ""} ${completed ? "is-done" : ""} ${className ?? ""}`}
      style={
        {
          "--p": String(initialProgressFor(scene)),
          "--mask-inner": `${Math.max(0, (scene.radiusPx ?? 120) - (scene.featherPx ?? 36))}px`,
          "--mask-outer": `${scene.radiusPx ?? 120}px`,
        } as React.CSSProperties
      }
      data-touch={capturesScroll ? "none" : "auto"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="iscene__layer iscene__after" src={assets.after} alt="" draggable={false} />
      {!isMaskBrush && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="iscene__layer iscene__before" src={assets.before} alt="" draggable={false} />
      )}
      {isMaskBrush && <canvas ref={canvas} className="iscene__layer iscene__frost" />}

      {scene.primitive === "slider" && (
        <>
          <div className="iscene__seam" aria-hidden="true" />
          <div className="iscene__handle" aria-hidden="true">
            <span>◀</span>
            <span>▶</span>
          </div>
        </>
      )}

      {/*
        The cue says what kind of thing this is, not merely that something is
        here. A ring that pulses means tap; a ring that fills means hold; a
        ring with a chevron drifting out of it means drag, and it drifts the
        way the finger should go. Guessing by poking at the picture is not an
        interaction, it is a puzzle, and a reader only plays that once.
      */}
      {scene.hotspot && status === "ready" && !completed && (
        <div
          className={`iscene__cue iscene__cue--${affordance}`}
          aria-hidden="true"
          style={
            {
              left: `${scene.hotspot.x * 100}%`,
              top: `${scene.hotspot.y * 100}%`,
              "--cue-angle": `${dragCueAngle(scene)}deg`,
            } as React.CSSProperties
          }
        >
          <span className="iscene__cue-ring" />
          <span className="iscene__cue-ring" />
          <span className="iscene__cue-ring" />
          {affordance === "hold" && <span className="iscene__cue-fill" />}
          {affordance === "drag" && <span className="iscene__cue-arrow">›</span>}
        </div>
      )}

      {status === "loading" && <div className="iscene__state">Загружаем сцену…</div>}
      {status === "failed" && (
        <div className="iscene__state">Картинки не загрузились — интерактив выключен</div>
      )}

      {status === "ready" && (
        <div className={`iscene__hint ${completed ? "is-faded" : ""}`}>
          {/* Said out loud, because the ring alone is decoration until you
              know it is a control. It is the first thing to go once the
              reader has done it: a label that stays is nagging. */}
          <span className="iscene__badge">
            <span className="iscene__badge-dot" aria-hidden="true" />
            Доступно действие
          </span>
          <span className="iscene__hint-text">{scene.hint}</span>
          <i aria-hidden="true" />
        </div>
      )}

      {completed && (
        <button type="button" className="iscene__reset" onClick={reset}>
          Ещё раз
        </button>
      )}
    </div>
  );
}
