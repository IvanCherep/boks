"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { CURTAIN_TIE_Y, curtainEdgeAt, curtainShape } from "./curtain-shape";
import type { Curtain } from "./curtain-gl";

/**
 * The author stage's curtain as the opening of a series piece (under test,
 * 2026-11-11: `curtain` in `series-catalogue.ts`). The piece opens behind the
 * closed velvet with its title on it; once the recording can play, the
 * ribbon draws the curtain aside, the cloth fades, and `onOpened` starts the
 * voice. A tap anywhere opens it at once.
 *
 * `closing` is the end: when the voice has ended the cloth fades in drawn
 * aside, closes over the last picture with the title coming back on it,
 * holds a moment, and `onDone` lets the ending follow. A tap closes it at once.
 *
 * The same cloth as the author page (`curtain-gl.ts`, `curtain-shape.ts`):
 * one velvet texture and a shader drawn only while the curtain moves. Without
 * WebGL the CSS velvet stands in; with reduced motion there is no curtain.
 */
const clip = (value: number) => Math.min(1, Math.max(0, value));
const edgeSamples = [0, 0.16, 0.32, 0.44, 0.51, CURTAIN_TIE_Y, 0.61, 0.69, 0.81, 0.92, 1];
/** Longest the curtain waits for the recording before opening anyway. */
const waitAtMostMs = 6000;
/** The title on the velvet, read before anything moves. */
const holdMs = 650;
const openMs = 2350;
const fadeMs = 600;
const closeMs = 2200;
/** The closed curtain with the title, before the ending comes up over it. */
const closedHoldMs = 1100;

export function CurtainOpening({
  title,
  byline,
  ready = true,
  closing = false,
  onDone,
}: {
  title: string;
  byline: string;
  /** Opening only: whether the voice can play; the curtain waits for it. */
  ready?: boolean;
  closing?: boolean;
  onDone: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [gone, setGone] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const done = useRef(onDone);
  const start = useRef<((quick: boolean) => void) | null>(null);
  const canStart = useRef(ready);
  useEffect(() => {
    done.current = onDone;
    canStart.current = ready;
  }, [onDone, ready]);
  const closingRef = useRef(closing);

  useLayoutEffect(() => {
    const node = stage.current;
    if (node) paint(node, closingRef.current ? 1 : 0, node.clientWidth, node.clientHeight);
  }, []);

  useEffect(() => {
    const node = stage.current;
    const cloth = canvas.current;
    if (!node || !cloth) return;
    let disposed = false;
    let curtain: Curtain | null = null;
    let animation = 0;
    let begun = false;
    const timers: number[] = [];
    const later = (callback: () => void, ms: number) => timers.push(window.setTimeout(callback, ms));
    let width = node.clientWidth;
    let height = node.clientHeight;
    const closes = closingRef.current;
    let opening = closes ? 1 : 0;
    const draw = (open: number, tension = 0) => {
      opening = clip(open);
      paint(node, opening, width, height);
      curtain?.render(opening, tension);
    };
    const resize = new ResizeObserver(() => {
      width = node.clientWidth;
      height = node.clientHeight;
      draw(opening);
    });
    resize.observe(node);

    let finished = false;
    const finish = () => {
      if (disposed || finished) return;
      finished = true;
      if (closes) {
        later(() => !disposed && done.current(), closedHoldMs);
        return;
      }
      setLeaving(true);
      done.current();
      later(() => !disposed && setGone(true), fadeMs);
    };
    let quickened = false;
    const run = (quick: boolean) => {
      if (begun && (!quick || quickened || finished)) return;
      begun = true;
      quickened = quick;
      cancelAnimationFrame(animation);
      const from = opening;
      const to = closes ? 0 : 1;
      const duration = quick ? 700 : closes ? closeMs : openMs;
      const started = performance.now();
      const tick = (now: number) => {
        if (disposed) return;
        const t = clip((now - started) / duration);
        const progress = quick ? 1 - (1 - t) ** 3 : t * t * t * (t * (t * 6 - 15) + 10);
        draw(from + (to - from) * progress, (quick ? 0.25 : 0.6) * Math.sin(Math.PI * t));
        // Opening, the voice starts as the cloth reaches the wall, not after it has settled.
        if (closes ? t >= 1 : t >= 0.86) return finish();
        animation = requestAnimationFrame(tick);
      };
      animation = requestAnimationFrame(tick);
    };
    start.current = run;

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      begun = true;
      finished = true;
      later(() => {
        if (disposed) return;
        done.current();
        setGone(true);
      }, 0);
    } else if (closes) {
      void import("./curtain-gl").then(({ createCurtain }) => {
        if (disposed) return;
        curtain = createCurtain(cloth, node);
        draw(opening);
      });
      // The drawn-aside cloth fades in first (CSS), then closes.
      later(() => run(false), fadeMs);
    } else {
      const glReady = import("./curtain-gl").then(({ createCurtain }) => {
        if (disposed) return false;
        curtain = createCurtain(cloth, node);
        return Promise.race([curtain?.ready ?? Promise.resolve(false), new Promise((resolve) => window.setTimeout(resolve, 900))]);
      });
      const waited = performance.now();
      const poll = () => {
        if (disposed || begun) return;
        if (canStart.current || performance.now() - waited > waitAtMostMs) later(() => run(false), holdMs);
        else later(poll, 120);
      };
      void glReady.then(() => {
        if (!disposed) draw(opening);
        poll();
      });
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(animation);
      timers.forEach((timer) => window.clearTimeout(timer));
      resize.disconnect();
      curtain?.destroy();
      start.current = null;
    };
  }, []);

  if (gone) return null;
  return (
    <div
      ref={stage}
      className={`as pc${closing ? " pc--closing" : ""}${leaving ? " pc--leaving" : ""}`}
      style={{ "--tie": `${CURTAIN_TIE_Y * 100}%`, "--pc-fade": `${fadeMs}ms` } as CSSProperties}
      onPointerDown={() => start.current?.(true)}
      aria-hidden="true"
    >
      <div className="as-velvet"><div className="as-fabric" /></div>
      <canvas ref={canvas} className="as-cloth" />
      <div className="as-floor" />
      <span className="as-ribbon as-ribbon--still">
        <span className="as-ribbon__art">
          <span className="as-ribbon__body" />
          <span className="as-ribbon__tip" />
          <span className="as-ribbon__word" />
          <span className="as-ribbon__puck" />
        </span>
      </span>
      <div className="pc-title">
        {byline && <p>{byline}</p>}
        <h1>{title}</h1>
      </div>
    </div>
  );
}

/** The curtain's geometry as CSS variables, as on the author stage. */
function paint(node: HTMLElement, opening: number, width: number, height: number) {
  const { edge, upperFlare } = curtainShape(opening, width, height);
  const points = edgeSamples.map((y) => `${curtainEdgeAt(opening, width, height, y).toFixed(1)}px ${y * 100}%`);
  node.style.setProperty("--ribbon-ink", clip((edge - 78) / 26).toFixed(3));
  node.style.setProperty("--edge", `${edge}px`);
  node.style.setProperty("--top-flare", `${upperFlare}px`);
  node.style.setProperty("--stage-width", `${width}px`);
  node.style.setProperty("--fabric-clip", `polygon(0 0,${points.join(",")},0 100%)`);
  node.style.setProperty("--pc-title", clip(1 - opening * 2.6).toFixed(3));
  node.dataset.painted = "";
}
