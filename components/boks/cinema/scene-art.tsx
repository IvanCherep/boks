"use client";

import { useMemo } from "react";
import { sceneImageFor, sceneImageFraming } from "@/components/boks/cinema/scene-image";

/**
 * The picture behind the words, drawn rather than fetched.
 *
 * The idea this prototype is testing is "read it, hear it, and look at
 * something while you do". The obvious way to get the something is to generate
 * images and serve them, which means an image pipeline, storage, a bill, and a
 * review process for pictures nobody has seen - none of which is needed to
 * answer the question being asked.
 *
 * So the scene is drawn in the browser from the boks's own id: three ranks of
 * roofs, domes and spires receding into haze, lit windows, a lamp that casts
 * the light actually in the frame, snow, and a palette that walks from dusk to
 * first light as the story runs. It costs nothing, needs no network, can never
 * illustrate the wrong words, and is the same picture every time.
 *
 * The canvas is tall on purpose. A landscape frame cropped to a phone showed
 * three enormous buildings; depth needs room above the roofline.
 */

type Palette = {
  name: string;
  skyTop: string;
  skyMid: string;
  horizon: string;
  near: string;
  far: string;
  window: string;
  glow: string;
  snow: string;
};

/** Dusk, deep night, snowlight, small hours, first light. In that order. */
const palettes: Palette[] = [
  {
    name: "dusk",
    skyTop: "#131a33",
    skyMid: "#3b3550",
    horizon: "#c07b46",
    near: "#0b0e1a",
    far: "#3a3346",
    window: "#ffd190",
    glow: "#ffae5c",
    snow: "#f6eddf",
  },
  {
    name: "night",
    skyTop: "#070c1c",
    skyMid: "#16203c",
    horizon: "#405c86",
    near: "#04060f",
    far: "#212c49",
    window: "#ffc879",
    glow: "#ffa64f",
    snow: "#e9effc",
  },
  {
    name: "snowlight",
    skyTop: "#0d1730",
    skyMid: "#2c3c63",
    horizon: "#7e99c6",
    near: "#070c19",
    far: "#33446b",
    window: "#ffd79a",
    glow: "#ffbe66",
    snow: "#ffffff",
  },
  {
    name: "small hours",
    skyTop: "#04070f",
    skyMid: "#0e1526",
    horizon: "#26344f",
    near: "#02040a",
    far: "#151f36",
    window: "#ffbc66",
    glow: "#ff9a3d",
    snow: "#dbe5fa",
  },
  {
    name: "first light",
    skyTop: "#1d2951",
    skyMid: "#6b5f74",
    horizon: "#dda066",
    near: "#0d1222",
    far: "#41405c",
    window: "#fff0c4",
    glow: "#ffd089",
    snow: "#fff7ea",
  },
];

/** Seeded, so a boks is the same picture on every open. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Roof = "flat" | "pitched" | "dome" | "spire";

type Building = {
  x: number;
  width: number;
  height: number;
  roof: Roof;
  windows: { x: number; y: number }[];
};

const canvasWidth = 400;
const canvasHeight = 800;

function buildRank(
  random: () => number,
  baseline: number,
  scale: number,
  lit: number
): Building[] {
  const buildings: Building[] = [];
  let x = -30 * scale;
  while (x < canvasWidth + 30) {
    const width = (26 + random() * 52) * scale;
    const height = (52 + random() * 130) * scale;
    const roll = random();
    const roof: Roof = roll > 0.9 ? "spire" : roll > 0.78 ? "dome" : roll > 0.52 ? "pitched" : "flat";

    const windows: { x: number; y: number }[] = [];
    const columns = Math.max(1, Math.round(width / (13 * scale)));
    const rows = Math.max(1, Math.round(height / (20 * scale)));
    const inset = (width - (columns - 1) * 13 * scale) / 2;
    for (let c = 0; c < columns; c += 1) {
      for (let r = 0; r < rows; r += 1) {
        if (random() < lit) {
          windows.push({
            x: x + inset + c * 13 * scale - 2 * scale,
            y: baseline - height + 14 * scale + r * 20 * scale,
          });
        }
      }
    }
    buildings.push({ x, width, height, roof, windows });
    x += width + random() * 10 * scale;
  }
  return buildings;
}

function roofPath(b: Building, baseline: number) {
  const top = baseline - b.height;
  const shoulder = Math.min(16, b.width * 0.3);
  if (b.roof === "pitched") {
    return `M${b.x} ${baseline} L${b.x} ${top + shoulder} L${b.x + b.width / 2} ${top} L${b.x + b.width} ${top + shoulder} L${b.x + b.width} ${baseline} Z`;
  }
  return `M${b.x} ${baseline} L${b.x} ${top} L${b.x + b.width} ${top} L${b.x + b.width} ${baseline} Z`;
}

function Rank({
  buildings,
  baseline,
  fill,
  windowFill,
  windowSize,
  opacity,
}: {
  buildings: Building[];
  baseline: number;
  fill: string;
  windowFill: string;
  windowSize: number;
  opacity: number;
}) {
  return (
    <g opacity={opacity}>
      {buildings.map((b, index) => {
        const top = baseline - b.height;
        return (
          <g key={index}>
            <path d={roofPath(b, baseline)} fill={fill} />
            {b.roof === "dome" && (
              <>
                <path
                  d={`M${b.x + b.width * 0.18} ${top} Q${b.x + b.width / 2} ${top - b.width * 0.72} ${b.x + b.width * 0.82} ${top} Z`}
                  fill={fill}
                />
                <rect x={b.x + b.width / 2 - 0.9} y={top - b.width * 0.62} width="1.8" height={b.width * 0.2} fill={fill} />
              </>
            )}
            {b.roof === "spire" && (
              <path
                d={`M${b.x + b.width * 0.4} ${top} L${b.x + b.width / 2} ${top - b.width * 1.15} L${b.x + b.width * 0.6} ${top} Z`}
                fill={fill}
              />
            )}
            {b.windows.map((w, windowIndex) => (
              <rect
                key={windowIndex}
                x={w.x}
                y={w.y}
                width={windowSize}
                height={windowSize * 1.35}
                rx={windowSize * 0.22}
                fill={windowFill}
              />
            ))}
          </g>
        );
      })}
    </g>
  );
}

export function SceneArt({
  seed,
  scene,
  sceneCount,
  storyId,
  className,
}: {
  seed: number;
  scene: number;
  sceneCount: number;
  storyId: string;
  className?: string;
}) {
  const picture = sceneImageFor(storyId, scene);
  /**
   * A painted boks does not draw the city underneath it.
   *
   * The drawn scene was written to be what you see while the illustration
   * loads and what you see if it never arrives, and for a boks with no art of
   * its own it is still the whole picture. But where six real paintings exist
   * it is covered completely - the illustration is opaque and full bleed - and
   * every one of its ~270 nodes, its infinite drift and its fractal-noise
   * grain over 400x800 was being rasterised to be seen by nobody. Two of them
   * during a dissolve, which is exactly when there is least to spare.
   *
   * What it was for survives as a wash in the scene's own palette: something
   * behind the picture while it decodes, in the right colours, for the cost of
   * a gradient.
   */
  const painted = !picture.placeholder;

  const art = useMemo(() => {
    const palette = palettes[(seed + scene) % palettes.length];
    if (painted) return { palette, drawn: null };

    const random = mulberry32(seed + scene * 9176);

    // Three ranks, each lower and larger than the one behind it.
    const far = buildRank(random, 556, 0.5, 0.1);
    const mid = buildRank(random, 624, 0.78, 0.16);
    const near = buildRank(random, 706, 1.08, 0.2);

    const stars = Array.from({ length: 110 }, () => ({
      x: random() * canvasWidth,
      y: random() * 470,
      r: random() * 1.1 + 0.2,
      o: random() * 0.75 + 0.1,
    }));

    // The lamp anchors the light and moves across the frame from scene to
    // scene, so six pictures do not look like one picture recoloured.
    const lampX = 46 + ((seed + scene * 83) % 310);
    const lampY = 512 + (((seed >> 3) + scene * 29) % 70);
    const moonX = ((seed >> 5) + scene * 61) % canvasWidth;
    const moonY = 90 + (((seed >> 7) + scene * 17) % 120);

    const flakes = Array.from({ length: 46 }, (_, index) => ({
      left: random() * 100,
      delay: -random() * 20,
      duration: 13 + random() * 16,
      size: 1.2 + random() * 3,
      drift: (random() - 0.5) * 80,
      opacity: 0.2 + random() * 0.55,
      key: index,
    }));

    return { palette, drawn: { far, mid, near, stars, lampX, lampY, moonX, moonY, flakes } };
  }, [seed, scene, painted]);

  const { palette, drawn } = art;
  const uid = `${seed}-${scene}`;
  // The stand-in is moved around to give six scenes six frames; real art is
  // shown as it was painted.
  const framing = picture.placeholder ? sceneImageFraming(scene, sceneCount) : null;

  return (
    <div
      className={`cinema-scene ${painted ? "cinema-scene--painted" : ""} ${className ?? ""}`}
      aria-hidden="true"
    >
      {drawn ? (
        <svg
          className="cinema-scene__art"
          viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <linearGradient id={`sky-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={palette.skyTop} />
              <stop offset="44%" stopColor={palette.skyMid} />
              <stop offset="72%" stopColor={palette.horizon} />
              <stop offset="100%" stopColor={palette.near} />
            </linearGradient>
            <radialGradient id={`bloom-${uid}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={palette.glow} stopOpacity="0.9" />
              <stop offset="22%" stopColor={palette.glow} stopOpacity="0.4" />
              <stop offset="100%" stopColor={palette.glow} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`moon-${uid}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={palette.snow} stopOpacity="0.85" />
              <stop offset="18%" stopColor={palette.snow} stopOpacity="0.28" />
              <stop offset="100%" stopColor={palette.snow} stopOpacity="0" />
            </radialGradient>
            {/* Air between the ranks, so the far roofs sit behind something. */}
            <linearGradient id={`haze-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={palette.horizon} stopOpacity="0" />
              <stop offset="100%" stopColor={palette.horizon} stopOpacity="0.55" />
            </linearGradient>
            {/* The grain that stops flat vector colour looking like flat vector colour. */}
            <filter id={`grain-${uid}`} x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed={seed % 100} />
              <feColorMatrix type="saturate" values="0" />
            </filter>
          </defs>

          <rect width={canvasWidth} height={canvasHeight} fill={`url(#sky-${uid})`} />

          {drawn.stars.map((star, index) => (
            <circle key={index} cx={star.x} cy={star.y} r={star.r} fill={palette.snow} opacity={star.o} />
          ))}

          <circle cx={drawn.moonX} cy={drawn.moonY} r="150" fill={`url(#moon-${uid})`} />
          <circle cx={drawn.moonX} cy={drawn.moonY} r="13" fill={palette.snow} opacity="0.92" />

          <Rank buildings={drawn.far} baseline={556} fill={palette.far} windowFill={palette.window} windowSize={1.9} opacity={0.75} />
          <rect x="0" y="360" width={canvasWidth} height="230" fill={`url(#haze-${uid})`} />

          <Rank buildings={drawn.mid} baseline={624} fill={palette.near} windowFill={palette.window} windowSize={2.7} opacity={0.82} />
          <rect x="0" y="470" width={canvasWidth} height="180" fill={`url(#haze-${uid})`} opacity="0.55" />

          {/* The lamp's light, under the nearest roofs so it spills from behind them. */}
          <circle cx={drawn.lampX} cy={drawn.lampY} r="210" fill={`url(#bloom-${uid})`} />

          <Rank buildings={drawn.near} baseline={706} fill={palette.near} windowFill={palette.window} windowSize={3.6} opacity={1} />

          {/* The lamp itself: post, hood, and a small fierce source. */}
          <g>
            <rect x={drawn.lampX - 1.8} y={drawn.lampY} width="3.6" height={720 - drawn.lampY} fill={palette.near} />
            <path
              d={`M${drawn.lampX - 9} ${drawn.lampY} L${drawn.lampX - 5.5} ${drawn.lampY - 12} L${drawn.lampX + 5.5} ${drawn.lampY - 12} L${drawn.lampX + 9} ${drawn.lampY} Z`}
              fill={palette.near}
            />
            <circle cx={drawn.lampX} cy={drawn.lampY - 5} r="4.4" fill={palette.window} />
            <circle cx={drawn.lampX} cy={drawn.lampY - 5} r="13" fill={palette.glow} opacity="0.45" />
          </g>

          {/* Snow on the ground, catching the lamp above it. */}
          <path
            d={`M0 ${canvasHeight} L0 726 Q100 706 200 720 Q300 734 400 712 L400 ${canvasHeight} Z`}
            fill={palette.snow}
            opacity="0.14"
          />
          <ellipse cx={drawn.lampX} cy="742" rx="120" ry="30" fill={palette.glow} opacity="0.16" />

          <rect
            width={canvasWidth}
            height={canvasHeight}
            filter={`url(#grain-${uid})`}
            opacity="0.055"
            style={{ mixBlendMode: "overlay" }}
          />
        </svg>
      ) : (
        <div
          className="cinema-scene__wash"
          style={{
            background: `linear-gradient(180deg, ${palette.skyTop} 0%, ${palette.skyMid} 46%, ${palette.near} 100%)`,
          }}
        />
      )}

      {/* The illustration, over the drawn scene so that one is what is seen
          while this loads and what is seen if it never arrives. */}
      {/* A plain <img>: this is a full-bleed backdrop served from our own
          origin, already sized for the job, and the optimiser this rule points
          at is not configured on the Worker. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="cinema-scene__picture"
        src={picture.src}
        alt=""
        decoding="async"
        // Scene one is the frame the reader is waiting on; the rest arrive
        // while something is already on screen.
        fetchPriority={scene === 0 ? "high" : "low"}
        style={
          framing
            ? { objectPosition: framing.objectPosition, filter: framing.filter, scale: String(framing.scale) }
            : undefined
        }
      />

      {/* Weather belongs to the drawn scene, which is a winter street. A
          painting has its own - the sixth scene of the lion is inside a cage,
          and snow was falling through the roof of it. */}
      {drawn && (
        <div className="cinema-scene__snow">
          {drawn.flakes.map((flake) => (
            <span
              key={flake.key}
              style={{
                left: `${flake.left}%`,
                width: `${flake.size}px`,
                height: `${flake.size}px`,
                opacity: flake.opacity,
                animationDelay: `${flake.delay}s`,
                animationDuration: `${flake.duration}s`,
                // Read by the keyframes, so each flake falls its own way.
                ["--cinema-drift" as string]: `${flake.drift}px`,
              }}
            />
          ))}
        </div>
      )}

      <div className="cinema-scene__vignette" />
    </div>
  );
}
