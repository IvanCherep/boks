/**
 * Living annual rings around an author's portrait (design v49).
 *
 * 26 related contours flex in overlapping waves while two broad washes of
 * light cross them; no particles, no rotation, no random jumps. Everything is
 * deterministic in time, so a paused field resumes exactly where it stopped.
 *
 * Kept light on purpose - it sits behind a page people scroll on phones:
 * - at most 30 frames a second (the slowest wave is 17 s; 60 fps buys nothing);
 * - 96 points a contour on a phone-sized field, 144 above 800 px;
 * - device pixel ratio capped at 1.5;
 * - it stops when the field is off screen, the tab is hidden, the caller
 *   pauses it (a sheet is open) or the reader asks for reduced motion, which
 *   gets one still frame.
 */

const TAU = Math.PI * 2;
const RING_COUNT = 26;
const INNER_RADIUS = 0.112;
const OUTER_RADIUS = 0.452;
const FRAME_MS = 1000 / 30;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const smoothstep = (from: number, to: number, value: number) => {
  const v = clamp((value - from) / (to - from), 0, 1);
  return v * v * (3 - 2 * v);
};

type Ring = {
  u: number; radius: number; sinPhase3: number; cosPhase3: number; sinPhase7: number; cosPhase7: number;
  width: number; opacity: number; edge: number; warm: boolean;
};

type Geometry = {
  pointCount: number;
  cos: Float32Array; sin: Float32Array; sin3: Float32Array; cos3: Float32Array; sin7: Float32Array; cos7: Float32Array;
  rings: Ring[];
  field3: Float32Array; field3Q: Float32Array; field7: Float32Array; field7Q: Float32Array;
  x: Float32Array; y: Float32Array;
};

function createGeometry(pointCount: number): Geometry {
  const make = () => new Float32Array(pointCount);
  const cos = make(), sin = make(), sin3 = make(), cos3 = make(), sin7 = make(), cos7 = make();
  for (let j = 0; j < pointCount; j += 1) {
    const theta = (TAU * j) / pointCount;
    cos[j] = Math.cos(theta); sin[j] = Math.sin(theta);
    sin3[j] = Math.sin(theta * 3); cos3[j] = Math.cos(theta * 3);
    sin7[j] = Math.sin(theta * 7); cos7[j] = Math.cos(theta * 7);
  }
  const rings = Array.from({ length: RING_COUNT }, (_, i): Ring => {
    const u = i / (RING_COUNT - 1);
    const material = (i * 0.61803398875) % 1;
    return {
      u,
      radius: INNER_RADIUS + (OUTER_RADIUS - INNER_RADIUS) * u,
      sinPhase3: Math.sin(i * 0.19), cosPhase3: Math.cos(i * 0.19),
      sinPhase7: Math.sin(-i * 0.14), cosPhase7: Math.cos(-i * 0.14),
      width: 0.72 + material * 0.23 + (i % 7 === 3 ? 0.12 : 0),
      opacity: 0.255 + material * 0.065 + (i % 7 === 3 ? 0.025 : 0),
      edge: 1 - 0.23 * smoothstep(0.75, 1, u),
      warm: i === 17,
    };
  });
  return { pointCount, cos, sin, sin3, cos3, sin7, cos7, rings, field3: make(), field3Q: make(), field7: make(), field7Q: make(), x: make(), y: make() };
}

function updateField(g: Geometry, time: number) {
  const phase3 = 1.12 * Math.sin((TAU * time) / 9.8 + 0.35) + 0.23 * Math.sin((TAU * time) / 16.7 + 1.4);
  const phase7 = -0.78 * Math.sin((TAU * time) / 12.7 + 1.1) + 0.18 * Math.sin((TAU * time) / 7.9 + 0.2);
  const s3 = Math.sin(phase3), c3 = Math.cos(phase3), s7 = Math.sin(phase7), c7 = Math.cos(phase7);
  for (let j = 0; j < g.pointCount; j += 1) {
    g.field3[j] = g.sin3[j] * c3 + g.cos3[j] * s3;
    g.field3Q[j] = g.cos3[j] * c3 - g.sin3[j] * s3;
    g.field7[j] = g.cos7[j] * c7 - g.sin7[j] * s7;
    g.field7Q[j] = g.sin7[j] * c7 + g.cos7[j] * s7;
  }
  return 0.95 + 0.017 * Math.sin((TAU * time) / 11.3 + 0.4);
}

function gradients(context: CanvasRenderingContext2D, cx: number, cy: number, size: number, time: number) {
  const angle = -0.82 + 0.46 * Math.sin((TAU * time) / 10.9 + 0.3);
  const dx = Math.cos(angle) * size * 0.53, dy = Math.sin(angle) * size * 0.53;
  const shift = size * 0.055 * Math.sin((TAU * time) / 7.6 + 0.9);
  const make = (stops: [number, string][]) => {
    const gradient = context.createLinearGradient(cx - dx + shift, cy - dy, cx + dx + shift, cy + dy);
    for (const [at, color] of stops) gradient.addColorStop(at, color);
    return gradient;
  };
  return {
    ink: make([[0, "rgba(127,153,138,0.40)"], [0.25, "rgba(166,184,165,0.76)"], [0.55, "rgba(220,224,207,0.98)"], [0.79, "rgba(238,235,222,1)"], [1, "rgba(171,188,168,0.57)"]]),
    // One contour has a faint clay undertone, not an orange stroke.
    warm: make([[0, "rgba(137,150,132,0.38)"], [0.25, "rgba(173,176,157,0.72)"], [0.55, "rgba(216,208,192,0.92)"], [0.79, "rgba(237,225,211,0.98)"], [1, "rgba(179,178,160,0.54)"]]),
  };
}

export type RingsController = { pause(): void; resume(): void; destroy(): void };

export function mountAuthorRings(canvas: HTMLCanvasElement, options: { host: HTMLElement; root?: Element | null }): RingsController {
  const { host } = options;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return { pause() {}, resume() {}, destroy() {} };

  let width = 0, height = 0, size = 0, dpr = 1;
  let geometry: Geometry | null = null;
  let elapsed = 0;
  let frame = 0;
  let previous: number | null = null;
  let lastDraw = 0;
  let paused = false, visible = true, destroyed = false, ready = false;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  function draw() {
    if (destroyed || !geometry || !size || !context) return;
    context.clearRect(0, 0, width, height);
    const cx = width / 2, cy = height / 2;
    const aspect = updateField(geometry, elapsed);
    const light = gradients(context, cx, cy, size, elapsed);
    const n = geometry.pointCount, x = geometry.x, y = geometry.y;
    const breathingSize = size * (1 + 0.008 * Math.sin((TAU * elapsed) / 8.6));
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const ring of geometry.rings) {
      const lightPhase = 0.5 + 0.5 * Math.cos((TAU * elapsed) / 6.8 - ring.u * 5.2 + 0.9);
      const counterPhase = 0.5 + 0.5 * Math.cos((TAU * elapsed) / 10.6 + ring.u * 4.4 + 2.1);
      const wash = lightPhase * lightPhase;
      context.globalAlpha = (ring.opacity + wash * 0.255 + counterPhase * counterPhase * 0.065) * ring.edge;
      context.strokeStyle = ring.warm ? light.warm : light.ink;
      context.lineWidth = ring.width + wash * 0.09;
      const breathing = 0.055 + 0.012 * Math.sin((TAU * elapsed) / 8.8 - ring.u * 1.4);
      const detail = 0.019 + 0.005 * Math.sin((TAU * elapsed) / 11.1 - ring.u * 2.2);
      const swell = 0.01 * Math.sin((TAU * elapsed) / 7.3 - ring.u * 4.2 + 0.5);
      const base = breathingSize * ring.radius;
      for (let j = 0; j < n; j += 1) {
        const shape = breathing * (geometry.field3[j] * ring.cosPhase3 + geometry.field3Q[j] * ring.sinPhase3)
          + detail * (geometry.field7[j] * ring.cosPhase7 - geometry.field7Q[j] * ring.sinPhase7);
        const r = base * (1 + shape + swell);
        x[j] = cx + geometry.cos[j] * r;
        y[j] = cy + geometry.sin[j] * r * aspect;
      }
      context.beginPath();
      context.moveTo((x[n - 1] + x[0]) * 0.5, (y[n - 1] + y[0]) * 0.5);
      for (let j = 0; j < n; j += 1) {
        const next = (j + 1) % n;
        context.quadraticCurveTo(x[j], y[j], (x[j] + x[next]) * 0.5, (y[j] + y[next]) * 0.5);
      }
      context.closePath();
      context.stroke();
    }
    context.globalAlpha = 1;
    if (!ready) { ready = true; host.classList.add("is-ready"); }
  }

  const canAnimate = () => !destroyed && !paused && visible && !document.hidden && !reduced.matches && size > 0;

  function tick(now: number) {
    frame = 0;
    if (!canAnimate()) { previous = null; return; }
    if (previous !== null) elapsed += Math.max(0, now - previous) / 1000;
    previous = now;
    if (now - lastDraw >= FRAME_MS - 1) { lastDraw = now; draw(); }
    frame = requestAnimationFrame(tick);
  }

  function sync() {
    if (!canAnimate()) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      previous = null;
    } else if (!frame) {
      previous = null;
      frame = requestAnimationFrame(tick);
    }
  }

  function resize() {
    if (destroyed) return;
    const nextWidth = Math.round(canvas.clientWidth);
    const nextHeight = Math.round(canvas.clientHeight || nextWidth);
    const nextDpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
    if (nextWidth === width && nextHeight === height && nextDpr === dpr) return;
    width = nextWidth; height = nextHeight; dpr = nextDpr;
    size = Math.min(width, height);
    if (!size) { sync(); return; }
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context!.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pointCount = size > 800 ? 144 : 96;
    if (!geometry || geometry.pointCount !== pointCount) geometry = createGeometry(pointCount);
    draw();
    sync();
  }

  const onVisibility = () => sync();
  const onMotion = () => { sync(); if (reduced.matches) draw(); };
  document.addEventListener("visibilitychange", onVisibility);
  reduced.addEventListener?.("change", onMotion);
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(canvas);
  const visibility = typeof IntersectionObserver === "function"
    ? new IntersectionObserver((entries) => { visible = entries.some((entry) => entry.isIntersecting); sync(); }, { root: options.root ?? null, threshold: 0 })
    : null;
  visibility?.observe(host);
  resize();

  return {
    pause() { paused = true; sync(); },
    resume() { paused = false; sync(); },
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      resizeObserver?.disconnect();
      visibility?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener?.("change", onMotion);
      host.classList.remove("is-ready");
      geometry = null;
    },
  };
}

/** Two letters for an author with no photo: first and last word of the name, else the handle. */
export function authorInitials(publicName: string | null | undefined, handle: string | null | undefined) {
  const words = String(publicName ?? "").normalize("NFC").trim().match(/\p{L}[\p{L}\p{M}\p{N}]*/gu) ?? [];
  const letters = words.length
    ? (words.length > 1 ? [words[0], words[words.length - 1]] : words).map((word) => Array.from(word ?? "")[0] ?? "").join("")
    : Array.from(String(handle ?? "").normalize("NFC").replace(/^\s*@+/, "")).filter((letter) => /[\p{L}\p{N}]/u.test(letter)).slice(0, 2).join("");
  return Array.from(letters.toLocaleUpperCase()).slice(0, 2).join("");
}

/** A public name set on two lines: everything but the last word, then the last word. */
export function splitAuthorName(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { given: "", family: words[0] ?? "" };
  return { given: words.slice(0, -1).join(" "), family: words[words.length - 1] };
}
