"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { CURTAIN_TIE_Y, curtainEdge, curtainEdgeAt, curtainShape } from "./curtain-shape";
import type { Curtain } from "./curtain-gl";

/**
 * The first screen of an author's page as a stage (design: boks-author-stage
 * handoff, 2026-11-10). A red velvet curtain, gathered by the yellow boks
 * ribbon, opens on the author's black-and-white portrait. The reader can take
 * the ribbon or the cloth and draw it themselves; a press on the ribbon, or
 * Enter, Space, the arrows, Home and End, opens and closes it.
 *
 * An author with no photo keeps the curtain closed: the name stands on the
 * velvet and nothing moves. Then no WebGL is loaded at all.
 *
 * Light on purpose: one 48 KB velvet texture, a few KB of ribbon, and a
 * shader that draws only when the curtain moves - no loop, no video, no
 * pre-rendered phases. The WebGL module loads after first paint; until then,
 * and wherever WebGL is missing, the same velvet is clipped by CSS.
 */
const clip = (value: number) => Math.min(1, Math.max(0, value));
const edgeSamples = [0, 0.16, 0.32, 0.44, 0.51, CURTAIN_TIE_Y, 0.61, 0.69, 0.81, 0.92, 1];

type Pull = {
  id: number;
  owner: Element;
  from: number;
  x: number;
  y: number;
  travel: number;
  last: number;
  time: number;
  velocity: number;
  moved: boolean;
  tension: number;
};

export function AuthorStage({
  photo,
  focus,
  header,
  title,
  handle,
  actions,
  toWorks,
  curtainLabel,
  ribbonHint,
  scrollRoot,
  libraryId,
}: {
  /** The author's photo; none keeps the curtain closed. */
  photo?: string | null;
  focus?: string;
  header: ReactNode;
  title: ReactNode;
  handle: ReactNode;
  actions: ReactNode;
  toWorks: string;
  curtainLabel: string;
  ribbonHint: string;
  /** The scrolling layer the stage sits in, for "To the boks". */
  scrollRoot: React.RefObject<HTMLElement | null>;
  libraryId: string;
}) {
  const stage = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const ribbon = useRef<HTMLButtonElement>(null);
  const locked = !photo;
  // One controller for the life of the stage; React only renders the markup.
  const control = useRef<{ open: (instant?: boolean) => void } | null>(null);

  // Before paint: the curtain stands where it starts, so it never jumps.
  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) return;
    const width = node.clientWidth;
    const height = node.clientHeight;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = locked || (!reduced && (scrollRoot.current?.scrollTop ?? 0) < 40) ? 0 : 1;
    paint(node, start, width, height);
  }, [locked, scrollRoot]);

  useEffect(() => {
    const node = stage.current;
    const cloth = canvas.current;
    const band = ribbon.current;
    if (!node || !cloth) return;
    let width = node.clientWidth;
    let height = node.clientHeight;
    let opening = Number(node.dataset.opening ?? 1);
    let target = opening;
    let animation = 0;
    let introTimer = 0;
    let interrupted = false;
    let suppressClick = false;
    let pull: Pull | null = null;
    let curtain: Curtain | null = null;
    let disposed = false;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");

    const draw = (open: number, tension = 0) => {
      opening = clip(open);
      paint(node, opening, width, height);
      curtain?.render(opening, tension);
    };

    const resize = new ResizeObserver(() => {
      width = node.clientWidth;
      height = node.clientHeight;
      draw(opening, pull?.moved ? 0.35 : 0);
    });
    resize.observe(node);

    if (locked) {
      // Closed for good: the CSS velvet is all there is.
      return () => resize.disconnect();
    }

    const stop = () => {
      cancelAnimationFrame(animation);
      window.clearTimeout(introTimer);
      animation = 0;
    };

    const ease = (to: number, duration: number, automatic = false, tension = 0.25) => {
      stop();
      target = to;
      band?.setAttribute("aria-pressed", String(target === 1));
      const from = opening;
      if (!duration || motion.matches || Math.abs(from - to) < 0.001) return draw(to);
      const started = performance.now();
      const tick = (now: number) => {
        const t = clip((now - started) / duration);
        // Accelerates and settles with zero speed at either end.
        const progress = automatic ? t * t * t * (t * (t * 6 - 15) + 10) : 1 - (1 - t) ** 3;
        const foldPull = automatic ? tension * Math.sin(Math.PI * t) : tension * (1 - t) ** 2;
        draw(from + (to - from) * progress, foldPull);
        animation = t < 1 ? requestAnimationFrame(tick) : 0;
      };
      animation = requestAnimationFrame(tick);
    };

    const go = (to: number, tension?: number) => {
      interrupted = true;
      ease(to, 370 + 1050 * Math.abs(to - opening), false, tension);
    };
    control.current = {
      open: (instant) => {
        interrupted = true;
        if (instant) ease(1, 0);
        else go(1);
      },
    };

    const onRibbonClick = (event: MouseEvent) => {
      if (event.detail && suppressClick) return;
      go(target === 1 ? 0 : 1);
    };
    const onRibbonKey = (event: KeyboardEvent) => {
      const next = ({ ArrowLeft: 1, ArrowRight: 0, Home: 1, End: 0 } as Record<string, number>)[event.key];
      if (next === undefined) return;
      event.preventDefault();
      go(next);
    };
    band?.addEventListener("click", onRibbonClick);
    band?.addEventListener("keydown", onRibbonKey);

    const onCurtainSurface = (event: PointerEvent) => {
      const element = event.target as Element;
      if (band?.contains(element)) return true;
      if (element.closest("button,a")) return false;
      const rect = node.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = (event.clientY - rect.top) / rect.height;
      return y > 0.08 && y < 0.91 && x < curtainEdgeAt(opening, width, height, y);
    };
    const onDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || pull) return;
      suppressClick = false;
      if (!onCurtainSurface(event)) return;
      const owner = band?.contains(event.target as Node) ? band : node;
      pull = {
        id: event.pointerId,
        owner,
        from: opening,
        x: event.clientX,
        y: event.clientY,
        travel: curtainEdge(0, width, height) - curtainEdge(1, width, height),
        last: event.clientX,
        time: event.timeStamp,
        velocity: 0,
        moved: false,
        tension: 0,
      };
      owner.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!pull || pull.id !== event.pointerId) return;
      const dx = pull.x - event.clientX;
      const dy = event.clientY - pull.y;
      // A vertical swipe scrolls the page; only a sideways one takes the cloth.
      if (!pull.moved && Math.abs(dx) < Math.max(6, Math.abs(dy))) return;
      if (!pull.moved) {
        interrupted = true;
        stop();
        pull.from = opening;
        pull.moved = true;
        node.dataset.dragging = "";
      }
      const elapsed = Math.max(12, event.timeStamp - pull.time);
      pull.velocity = 0.42 * pull.velocity + (0.58 * (pull.last - event.clientX)) / elapsed;
      pull.last = event.clientX;
      pull.time = event.timeStamp;
      pull.tension = clip(0.2 + Math.abs(pull.velocity) * 0.5);
      draw(pull.from + dx / Math.max(1, pull.travel), pull.tension);
    };
    const onUp = (event: PointerEvent) => {
      if (!pull || pull.id !== event.pointerId) return;
      const held = pull;
      pull = null;
      if (held.owner.hasPointerCapture(event.pointerId)) held.owner.releasePointerCapture(event.pointerId);
      if (!held.moved) return;
      delete node.dataset.dragging;
      suppressClick = true;
      const quick = event.timeStamp - held.time < 100 && Math.abs(held.velocity) > 0.38;
      let destination = target;
      if (event.type === "pointerup") destination = quick ? Number(held.velocity > 0) : Number(opening >= 0.5);
      go(destination, held.tension);
    };
    node.addEventListener("pointerdown", onDown);
    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerup", onUp);
    node.addEventListener("pointercancel", onUp);
    node.addEventListener("lostpointercapture", onUp);

    const onMotion = (event: MediaQueryListEvent) => {
      if (event.matches) {
        interrupted = true;
        ease(1, 0);
      }
    };
    const onHidden = () => {
      if (document.hidden && !interrupted && opening < 1) {
        interrupted = true;
        ease(1, 0);
      }
    };
    motion.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", onHidden);

    // The cloth: WebGL loads after first paint; the CSS velvet stands in until then.
    import("./curtain-gl").then(({ createCurtain }) => {
      if (disposed) return;
      curtain = createCurtain(cloth, node);
      const ready = curtain?.ready ?? Promise.resolve(false);
      if (opening < 1) {
        Promise.race([ready, new Promise((resolve) => window.setTimeout(resolve, 350))]).then(() => {
          if (disposed || interrupted) return;
          introTimer = window.setTimeout(() => {
            if (!interrupted) ease(1, 2350, true, 0.6);
          }, 280);
        });
      }
      void ready.then(() => !disposed && curtain?.render(opening));
    });

    return () => {
      disposed = true;
      stop();
      resize.disconnect();
      band?.removeEventListener("click", onRibbonClick);
      band?.removeEventListener("keydown", onRibbonKey);
      node.removeEventListener("pointerdown", onDown);
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerup", onUp);
      node.removeEventListener("pointercancel", onUp);
      node.removeEventListener("lostpointercapture", onUp);
      motion.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onHidden);
      curtain?.destroy();
      control.current = null;
    };
  }, [locked]);

  const goToWorks = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    control.current?.open(true);
    const library = document.getElementById(libraryId);
    library?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    library?.focus({ preventScroll: true });
  };

  return (
    <section ref={stage} className={`as${locked ? " as--closed" : ""}`} style={{ "--tie": `${CURTAIN_TIE_Y * 100}%` } as CSSProperties}>
      <div className="as-scenery" aria-hidden="true">
        {photo && (
          <div className="as-portrait">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="" fetchPriority="high" decoding="async" style={{ objectPosition: focus ?? "50% 40%" }} />
          </div>
        )}
        <div className="as-vignette" />
      </div>
      <div className="as-velvet" aria-hidden="true"><div className="as-fabric" /></div>
      {!locked && <canvas ref={canvas} className="as-cloth" aria-hidden="true" />}
      <div className="as-floor" aria-hidden="true" />
      <header className="as-top">{header}</header>
      {locked ? (
        <span className="as-ribbon as-ribbon--still" aria-hidden="true"><RibbonArt /></span>
      ) : (
        <button ref={ribbon} type="button" className="as-ribbon" aria-label={curtainLabel} title={ribbonHint} aria-pressed="true">
          <RibbonArt />
        </button>
      )}
      <div className="as-identity">
        {title}
        <p className="as-handle">{handle}</p>
      </div>
      <div className="as-bottom">
        {actions}
        <a className="as-to-works" href={`#${libraryId}`} onClick={goToWorks}>
          <span>{toWorks}</span>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v13m-5-5 5 5 5-5" /></svg>
        </a>
      </div>
    </section>
  );
}

function RibbonArt() {
  return (
    <span className="as-ribbon__art" aria-hidden="true">
      <span className="as-ribbon__body" />
      <span className="as-ribbon__tip" />
      <span className="as-ribbon__word" />
      <span className="as-ribbon__puck" />
    </span>
  );
}

/** The curtain's geometry as CSS variables: the fallback cloth, the ribbon and the name follow it. */
function paint(node: HTMLElement, opening: number, width: number, height: number) {
  const { edge, upperFlare } = curtainShape(opening, width, height);
  const points = edgeSamples.map((y) => `${curtainEdgeAt(opening, width, height, y).toFixed(1)}px ${y * 100}%`);
  node.style.setProperty("--ribbon-ink", clip((edge - 78) / 26).toFixed(3));
  node.style.setProperty("--edge", `${edge}px`);
  node.style.setProperty("--top-flare", `${upperFlare}px`);
  node.style.setProperty("--stage-width", `${width}px`);
  node.style.setProperty("--fabric-clip", `polygon(0 0,${points.join(",")},0 100%)`);
  node.dataset.opening = opening.toFixed(3);
}
