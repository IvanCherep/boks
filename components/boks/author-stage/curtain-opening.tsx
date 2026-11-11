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

export function CurtainOpening({ title, byline, ready, onOpened }: { title: string; byline: string; ready: boolean; onOpened: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [gone, setGone] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const opened = useRef(onOpened);
  const start = useRef<((quick: boolean) => void) | null>(null);
  const canStart = useRef(ready);
  useEffect(() => {
    opened.current = onOpened;
    canStart.current = ready;
  }, [onOpened, ready]);

  useLayoutEffect(() => {
    const node = stage.current;
    if (node) paint(node, 0, node.clientWidth, node.clientHeight);
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
    let opening = 0;
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

    const finish = () => {
      if (disposed) return;
      setLeaving(true);
      opened.current();
      later(() => !disposed && setGone(true), fadeMs);
    };
    const run = (quick: boolean) => {
      if (begun) return;
      begun = true;
      const duration = quick ? 700 : openMs;
      const started = performance.now();
      const tick = (now: number) => {
        if (disposed) return;
        const t = clip((now - started) / duration);
        const progress = quick ? 1 - (1 - t) ** 3 : t * t * t * (t * (t * 6 - 15) + 10);
        draw(progress, (quick ? 0.25 : 0.6) * Math.sin(Math.PI * t));
        // The voice starts as the cloth reaches the wall, not after it has settled.
        if (t >= 0.86) return finish();
        animation = requestAnimationFrame(tick);
      };
      animation = requestAnimationFrame(tick);
    };
    start.current = (quick) => {
      if (quick && begun) return;
      run(quick);
    };

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      begun = true;
      later(finish, 0);
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
      className={`as pc${leaving ? " pc--leaving" : ""}`}
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
