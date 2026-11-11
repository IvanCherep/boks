"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { CURTAIN_TIE_Y, curtainEdgeAt, curtainShape } from "./curtain-shape";
import type { Curtain } from "./curtain-gl";

/**
 * The author stage's curtain around a series piece: one curtain for the whole
 * performance (`curtain` in `series-catalogue.ts`).
 *
 *   start   the piece opens behind the closed velvet, its title on it; once
 *           the recording can play the ribbon draws it aside and `onOpened`
 *           starts the voice; the gathered cloth then fades away
 *   end     `closed` turns true: the cloth comes back gathered, closes over
 *           the last picture and the title returns; `onClosed` lets the
 *           player put its ending under it; after a moment the curtain opens
 *           again on that ending and fades away
 *
 * One WebGL context and one velvet upload for the whole piece, made at the
 * start, so the end costs nothing but drawing. The shader draws only while the
 * cloth moves. A tap during any movement finishes it quickly. Without WebGL
 * the CSS velvet stands in; with reduced motion there is no curtain and both
 * callbacks come at once.
 */
const clip = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const edgeSamples = [0, 0.16, 0.32, 0.44, 0.51, CURTAIN_TIE_Y, 0.61, 0.69, 0.81, 0.92, 1];

export const curtainTiming = {
  /** Longest the curtain waits for the recording before opening anyway. */
  waitAtMostMs: 6000,
  /** The title on the velvet before anything moves. */
  titleMs: 650,
  openMs: 2350,
  closeMs: 2200,
  /** The closed curtain with the title, at the end, before it opens on the ending. */
  closedMs: 1500,
  revealMs: 1900,
  fadeMs: 500,
  quickMs: 650,
} as const;

type Phase = "waiting" | "opening" | "open" | "closing" | "closed" | "revealing" | "done";

export function FormatCurtain({
  title,
  byline,
  ready,
  closed,
  onOpened,
  onClosed,
}: {
  title: string;
  byline: string;
  /** Whether the recording can play; the opening waits for it. */
  ready: boolean;
  /** The piece has ended: close, then open again on the ending. False again (play again) puts the curtain away. */
  closed: boolean;
  onOpened: () => void;
  onClosed: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onOpened, onClosed });
  const wants = useRef({ ready, closed });
  const control = useRef<{ wake: () => void; hurry: () => void } | null>(null);

  useEffect(() => {
    callbacks.current = { onOpened, onClosed };
    wants.current = { ready, closed };
    control.current?.wake();
  }, [onOpened, onClosed, ready, closed]);

  useLayoutEffect(() => {
    const node = stage.current;
    if (node) paint(node, 0, node.clientWidth, node.clientHeight);
  }, []);

  useEffect(() => {
    const node = stage.current;
    const cloth = canvas.current;
    if (!node || !cloth) return;
    const timing = curtainTiming;
    let disposed = false;
    let curtain: Curtain | null = null;
    let animation = 0;
    let timer = 0;
    let phase: Phase = "waiting";
    let opening = 0;
    let width = node.clientWidth;
    let height = node.clientHeight;
    const waitingSince = performance.now();
    let clothReady = false;

    const setPhase = (next: Phase) => {
      phase = next;
      node.dataset.phase = next;
    };
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

    /** One movement of the cloth; `at` fires once when it is that far through. */
    let current: { to: number; done: () => void; at?: { t: number; then: () => void } } | null = null;
    const move = (to: number, duration: number, done: () => void, at?: { t: number; then: () => void }, swing = 0.6, quick = false) => {
      cancelAnimationFrame(animation);
      const from = opening;
      const started = performance.now();
      const step = { to, done, at };
      current = step;
      const tick = (now: number) => {
        if (disposed) return;
        const t = clip((now - started) / duration);
        draw(from + (to - from) * (quick ? 1 - (1 - t) ** 3 : smooth(t)), swing * Math.sin(Math.PI * t));
        if (step.at && t >= step.at.t) {
          const then = step.at.then;
          step.at = undefined;
          then();
        }
        if (t >= 1) {
          current = null;
          return done();
        }
        animation = requestAnimationFrame(tick);
      };
      animation = requestAnimationFrame(tick);
    };
    /** Finishes the movement under way from where the cloth is, quickly. */
    const hurry = () => {
      if (!current) return;
      const { to, done, at } = current;
      move(to, timing.quickMs, done, at ? { t: Math.min(at.t, 0.86), then: at.then } : undefined, 0.25, true);
    };
    const later = (callback: () => void, ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(callback, ms);
    };

    const wake = () => {
      if (disposed) return;
      const { ready: canPlay, closed: ended } = wants.current;
      if (phase === "waiting" && clothReady && (canPlay || performance.now() - waitingSince > timing.waitAtMostMs)) {
        setPhase("opening");
        later(() => {
          move(1, timing.openMs, () => setPhase("open"), {
            // The voice starts as the cloth reaches the wall, not after it has settled.
            t: 0.86,
            then: () => callbacks.current.onOpened(),
          });
        }, timing.titleMs);
      } else if (phase === "open" && ended) {
        setPhase("closing");
        // The gathered cloth comes back (CSS fades it in), then closes.
        later(() => move(0, timing.closeMs, () => {
          setPhase("closed");
          callbacks.current.onClosed();
          later(() => {
            setPhase("revealing");
            move(1, timing.revealMs, () => setPhase("open"));
          }, timing.closedMs);
        }), timing.fadeMs);
      }
    };
    control.current = {
      wake,
      hurry: () => {
        if (phase === "closed") {
          // The ending is under it already: open now.
          window.clearTimeout(timer);
          setPhase("revealing");
          move(1, timing.quickMs, () => setPhase("open"), undefined, 0.25, true);
        } else if (phase === "opening" || phase === "closing" || phase === "revealing") {
          if (current) hurry();
        }
      },
    };

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // No curtain: the voice and the ending come as they would without one.
      setPhase("done");
      const reduced = { opened: false, closed: false };
      control.current = {
        hurry: () => {},
        wake: () => {
          if (!reduced.opened) {
            reduced.opened = true;
            callbacks.current.onOpened();
          }
          if (wants.current.closed && !reduced.closed) {
            reduced.closed = true;
            callbacks.current.onClosed();
          }
          if (!wants.current.closed) reduced.closed = false;
        },
      };
      window.setTimeout(() => control.current?.wake(), 0);
    } else {
      setPhase("waiting");
      void import("./curtain-gl")
        .then(({ createCurtain }) => {
          if (disposed) return false;
          curtain = createCurtain(cloth, node);
          return Promise.race([curtain?.ready ?? Promise.resolve(false), new Promise((resolve) => window.setTimeout(resolve, 900))]);
        })
        .catch(() => false)
        .then(() => {
          if (disposed) return;
          clothReady = true;
          draw(opening);
          wake();
        });
    }
    // The recording may never say it is ready: open anyway after a while.
    const giveUp = window.setTimeout(() => {
      clothReady = true;
      wake();
    }, timing.waitAtMostMs + 50);

    return () => {
      disposed = true;
      cancelAnimationFrame(animation);
      window.clearTimeout(timer);
      window.clearTimeout(giveUp);
      resize.disconnect();
      curtain?.destroy();
      control.current = null;
    };
  }, []);

  return (
    <div
      ref={stage}
      className="as pc"
      style={{ "--tie": `${CURTAIN_TIE_Y * 100}%`, "--pc-fade": `${curtainTiming.fadeMs}ms` } as CSSProperties}
      onPointerDown={() => control.current?.hurry()}
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
