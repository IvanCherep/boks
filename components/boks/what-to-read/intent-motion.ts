/**
 * The yellow boks ribbon that carries a new bok in after "Что почитать" is
 * applied. A port of the agreed prototype runtime (`intent-motion.js`, 2026-11-15)
 * as a module: same geometry and timings, nothing touches `window` on import.
 *
 * Decoration only. The new bok is committed underneath before `play`; removing
 * the layer - at the end, on cancel, resize or a hidden tab - always reveals
 * that bok, and nothing here changes the feed. `docs/reading-facets.md`.
 *
 * Differences from the prototype: a playing <video> or a <canvas> in the old
 * cover is frozen as an image of its current frame, so the snapshot never
 * plays or makes a sound; `previousControl` mode is not ported (the reader
 * always passes the old cover).
 */

const svgNamespace = "http://www.w3.org/2000/svg";
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const smooth = (value: number) => value * value * (3 - 2 * value);

/** Thickness of the yellow body, px. */
const band = 36;
/** Head travel and tail pull, ms: 1110 in all. */
const travelTime = 820;
const pullTime = 290;
export const ribbonDuration = travelTime + pullTime;

type Run = { layer: HTMLElement; frame: number; onVisibility: () => void; onResize: () => void };
let active: Run | null = null;

export function cancelIntentMotion() {
  if (!active) return;
  const run = active;
  active = null;
  cancelAnimationFrame(run.frame);
  document.removeEventListener("visibilitychange", run.onVisibility);
  window.removeEventListener("resize", run.onResize);
  run.layer.remove();
}

function svgNode(tag: string, attributes: Record<string, string | number> = {}) {
  const element = document.createElementNS(svgNamespace, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function removeInteraction(root: HTMLElement) {
  for (const element of [root, ...root.querySelectorAll<HTMLElement | SVGElement>("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name;
      if (name === "id" || name === "autofocus" || name === "href" || name === "src" && element instanceof HTMLVideoElement || name.startsWith("on") || name.startsWith("aria-") || name.startsWith("data-")) {
        element.removeAttribute(name);
      }
    }
    element.setAttribute("tabindex", "-1");
    element.style.pointerEvents = "none";
    element.style.transition = "none";
    element.style.animation = "none";
  }
  root.style.opacity = "1";
  root.style.margin = "0";
  root.style.transform = "none";
}

/** The current frame of a video or canvas as an <img>, or null when it cannot be read. */
function frozenFrame(source: HTMLVideoElement | HTMLCanvasElement): HTMLImageElement | null {
  try {
    const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    if (!width || !height) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(source, 0, 0, width, height);
    const image = document.createElement("img");
    image.src = canvas.toDataURL("image/webp", 0.8);
    return image;
  } catch {
    // A cross-origin frame taints the canvas; the poster is the next best thing.
    if (source instanceof HTMLVideoElement && source.poster) {
      const image = document.createElement("img");
      image.src = source.poster;
      return image;
    }
    return null;
  }
}

/**
 * A still copy of an element with its computed styles, safe to keep after
 * React replaces the original: no ids, handlers or ARIA, no playing media.
 */
export function captureIntentCover(source: Element | null): HTMLElement | null {
  if (!(source instanceof HTMLElement)) return null;
  const clone = source.cloneNode(true) as HTMLElement;
  const originals = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const copies = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
  originals.forEach((element, index) => {
    const copy = copies[index];
    if (!copy?.style) return;
    const computed = getComputedStyle(element);
    for (const property of Array.from(computed)) copy.style.setProperty(property, computed.getPropertyValue(property));
    if (element instanceof HTMLVideoElement || element instanceof HTMLCanvasElement) {
      const still = frozenFrame(element);
      if (still) {
        still.style.cssText = copy.style.cssText;
        copy.replaceWith(still);
      } else {
        copy.remove();
      }
    }
  });
  removeInteraction(clone);
  return clone;
}

export type IntentMotionOptions = {
  kind?: "sad" | "fun" | "think" | null;
  /** The new trigger: the ribbon travels at its height. */
  anchor: Element | null;
  /** `captureIntentCover` of the old cover, taken before React replaced it. */
  previousCover: Element | null;
  /**
   * Where the cover is now (the new one, in the old one's place). The snapshot
   * is laid exactly there: on a wide screen the cover is one column of the
   * reader, and stretched to the whole host it would black out the text.
   */
  coverBox?: Element | null;
  /** Called only when the ribbon ran to the end; clear busy state on cancel too. */
  done?: () => void;
};

/** Plays the ribbon over the reader screen `host`, revealing the bok already committed there. */
export function playIntentMotion(host: Element | null, { kind, anchor, previousCover, coverBox, done }: IntentMotionOptions) {
  cancelIntentMotion();
  const finish = () => done?.();
  if (!(host instanceof HTMLElement) || !host.isConnected || !(anchor instanceof Element) || !anchor.isConnected || !(previousCover instanceof HTMLElement)) {
    finish();
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden) {
    finish();
    return;
  }

  const hostBox = host.getBoundingClientRect();
  const anchorBox = anchor.getBoundingClientRect();
  const scaleY = hostBox.height / host.clientHeight;
  if (!host.clientWidth || !host.clientHeight || !scaleY || !anchorBox.height) {
    finish();
    return;
  }
  const width = host.clientWidth;
  const height = host.clientHeight;
  const half = band / 2;
  const middle = clamp((anchorBox.top - hostBox.top + anchorBox.height / 2) / scaleY, half + 2, height - half - 2);

  const layer = document.createElement("div");
  layer.className = "boks-intent-motion boks-intent-motion--cover";
  layer.setAttribute("aria-hidden", "true");
  layer.inert = true;
  layer.dataset.kind = kind ?? "reset";
  Object.assign(layer.style, { left: "0px", top: "0px", width: `${width}px`, height: `${height}px` });

  const oldSnapshot = document.createElement("div");
  oldSnapshot.className = "boks-intent-motion__cover";
  const oldCover = previousCover.cloneNode(true) as HTMLElement;
  removeInteraction(oldCover);
  const scaleX = hostBox.width / host.clientWidth || 1;
  const box = coverBox instanceof Element && coverBox.isConnected ? coverBox.getBoundingClientRect() : null;
  Object.assign(oldCover.style, box
    ? { position: "absolute", inset: "auto", left: `${(box.left - hostBox.left) / scaleX}px`, top: `${(box.top - hostBox.top) / scaleY}px`, width: `${box.width / scaleX}px`, height: `${box.height / scaleY}px` }
    : { position: "absolute", inset: "0", width: `${width}px`, height: `${height}px` });
  oldSnapshot.appendChild(oldCover);
  layer.appendChild(oldSnapshot);

  const canvas = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none" });
  const ribbon = svgNode("path", { class: "boks-intent-motion__ribbon", "stroke-width": band });
  const word = svgNode("text", { class: "boks-intent-motion__word", "text-anchor": "end", "dominant-baseline": "central" });
  word.textContent = "boks";
  const head = svgNode("g", { class: "boks-intent-motion__head" });
  head.appendChild(svgNode("circle", { r: half, class: "boks-intent-motion__cap" }));
  head.appendChild(svgNode("circle", { r: 13.5, class: "boks-intent-motion__dot" }));
  canvas.appendChild(ribbon);
  canvas.appendChild(word);
  canvas.appendChild(head);
  layer.appendChild(canvas);
  host.appendChild(layer);

  const run: Run = {
    layer,
    frame: 0,
    onVisibility: () => { if (document.hidden && active === run) cancelIntentMotion(); },
    onResize: () => { if (active === run) cancelIntentMotion(); },
  };
  active = run;
  document.addEventListener("visibilitychange", run.onVisibility);
  window.addEventListener("resize", run.onResize, { passive: true });

  const outside = half + 4;
  const distance = width + outside * 2;
  let started: number | null = null;

  // Stretch first, release second: the head carries the new scene across while
  // the tail stays outside the left edge; then the tail snaps after it.
  const frame = (time: number) => {
    if (active !== run) return;
    if (!host.isConnected || !layer.isConnected || document.hidden) {
      cancelIntentMotion();
      return;
    }
    if (started === null) started = time;
    const elapsed = time - started;
    const leading = -outside + distance * smooth(clamp(elapsed / travelTime, 0, 1));
    const pull = clamp((elapsed - travelTime) / pullTime, 0, 1);
    const trailing = -outside + distance * (1 - Math.pow(1 - pull, 3));
    // The red tip pulls the new scene into view; the body rides over it.
    oldSnapshot.style.clipPath = `inset(0 0 0 ${clamp(leading + half, 0, width)}px)`;
    ribbon.setAttribute("d", `M ${trailing} ${middle} L ${leading} ${middle}`);
    (ribbon as SVGElement).style.opacity = leading - trailing > 0.1 ? "1" : "0";
    word.setAttribute("x", String(leading - 27));
    word.setAttribute("y", String(middle - 1));
    (word as SVGElement).style.opacity = leading - trailing > 104 ? "1" : "0";
    head.setAttribute("transform", `translate(${leading} ${middle})`);
    (head as SVGElement).style.opacity = "1";
    if (elapsed >= ribbonDuration) {
      cancelIntentMotion();
      finish();
      return;
    }
    run.frame = requestAnimationFrame(frame);
  };
  run.frame = requestAnimationFrame(frame);
}
