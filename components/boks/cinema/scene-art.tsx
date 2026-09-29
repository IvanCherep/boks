"use client";

import { useMemo } from "react";

/**
 * The picture behind the words, drawn rather than fetched.
 *
 * The idea this prototype is testing is "read it, hear it, and look at
 * something while you do". The obvious way to get the something is to generate
 * images and serve them, which means an image pipeline, storage, a bill, and a
 * content policy for pictures nobody has reviewed - none of which a prototype
 * needs in order to answer the question it is asking.
 *
 * So the scene is drawn in the browser from the boks's own id: a skyline with
 * lit windows, domes and spires, a lamp with a real glow, snow, and a palette
 * that moves from dusk to deep night to first light as the story runs. It
 * costs nothing, it needs no network, it never shows the wrong picture for the
 * words, and because it is seeded it is the same picture every time.
 */

type Palette = {
  name: string;
  skyTop: string;
  skyBottom: string;
  haze: string;
  silhouette: string;
  window: string;
  glow: string;
  snow: string;
};

/** Dusk, deep night, snowlight, small hours, first light. In that order. */
const palettes: Palette[] = [
  {
    name: "dusk",
    skyTop: "#1a2340",
    skyBottom: "#5a4a52",
    haze: "#c98f5a",
    silhouette: "#0f1320",
    window: "#ffcf8a",
    glow: "#ffb865",
    snow: "#f4ecdf",
  },
  {
    name: "night",
    skyTop: "#0b1225",
    skyBottom: "#24304f",
    haze: "#3c5580",
    silhouette: "#060a14",
    window: "#ffc879",
    glow: "#ffad57",
    snow: "#e8eefc",
  },
  {
    name: "snowlight",
    skyTop: "#111d38",
    skyBottom: "#41547d",
    haze: "#7d97c4",
    silhouette: "#0a1020",
    window: "#ffd79a",
    glow: "#ffc06b",
    snow: "#ffffff",
  },
  {
    name: "small hours",
    skyTop: "#070b16",
    skyBottom: "#161f39",
    haze: "#2b3a5e",
    silhouette: "#04070e",
    window: "#ffbf6d",
    glow: "#ff9f45",
    snow: "#dce6fb",
  },
  {
    name: "first light",
    skyTop: "#243055",
    skyBottom: "#a8825f",
    haze: "#e0a86a",
    silhouette: "#101527",
    window: "#fff0c4",
    glow: "#ffd089",
    snow: "#fff6e8",
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

type Building = {
  x: number;
  width: number;
  height: number;
  roof: "flat" | "pitched" | "dome" | "spire";
  windows: { x: number; y: number }[];
};

function buildSkyline(random: () => number, width: number, baseline: number, scale: number) {
  const buildings: Building[] = [];
  let x = -20;
  while (x < width + 20) {
    const w = (18 + random() * 46) * scale;
    const h = (40 + random() * 150) * scale;
    const roll = random();
    const roof: Building["roof"] = roll > 0.92 ? "spire" : roll > 0.82 ? "dome" : roll > 0.6 ? "pitched" : "flat";

    // Lit windows, sparse: a street where every window is on reads as an
    // office block, not as somewhere people live.
    const windows: { x: number; y: number }[] = [];
    const columns = Math.max(1, Math.floor(w / (11 * scale)));
    const rows = Math.max(1, Math.floor(h / (17 * scale)));
    for (let c = 0; c < columns; c += 1) {
      for (let r = 0; r < rows; r += 1) {
        if (random() > 0.72) {
          windows.push({
            x: x + 5 * scale + c * 11 * scale,
            y: baseline - h + 10 * scale + r * 17 * scale,
          });
        }
      }
    }
    buildings.push({ x, width: w, height: h, roof, windows });
    x += w + random() * 8 * scale;
  }
  return buildings;
}

function buildingPath(b: Building, baseline: number, scale: number) {
  const top = baseline - b.height;
  if (b.roof === "pitched") {
    return `M${b.x} ${baseline} L${b.x} ${top + 12 * scale} L${b.x + b.width / 2} ${top} L${b.x + b.width} ${top + 12 * scale} L${b.x + b.width} ${baseline} Z`;
  }
  return `M${b.x} ${baseline} L${b.x} ${top} L${b.x + b.width} ${top} L${b.x + b.width} ${baseline} Z`;
}

export function SceneArt({ seed, scene, className }: { seed: number; scene: number; className?: string }) {
  const art = useMemo(() => {
    const random = mulberry32(seed + scene * 9176);
    const palette = palettes[(seed + scene) % palettes.length];

    const far = buildSkyline(random, 400, 250, 0.62);
    const near = buildSkyline(random, 400, 300, 1);

    const stars = Array.from({ length: 70 }, () => ({
      x: random() * 400,
      y: random() * 190,
      r: random() * 0.9 + 0.25,
      o: random() * 0.7 + 0.15,
    }));

    // The lamp anchors the light. It moves across the frame from scene to
    // scene so the pictures do not look like one picture recoloured.
    const lampX = 40 + ((seed + scene * 57) % 320);
    const lampY = 150 + (((seed >> 3) + scene * 13) % 40);

    const flakes = Array.from({ length: 34 }, (_, index) => ({
      left: random() * 100,
      delay: -random() * 18,
      duration: 12 + random() * 14,
      size: 1 + random() * 2.6,
      drift: (random() - 0.5) * 60,
      opacity: 0.25 + random() * 0.5,
      key: index,
    }));

    return { palette, far, near, stars, lampX, lampY, flakes };
  }, [seed, scene]);

  const { palette, far, near, stars, lampX, lampY, flakes } = art;
  const gradientId = `cinema-sky-${seed}-${scene}`;
  const glowId = `cinema-glow-${seed}-${scene}`;
  const hazeId = `cinema-haze-${seed}-${scene}`;

  return (
    <div className={`cinema-scene ${className ?? ""}`} aria-hidden="true">
      <svg className="cinema-scene__art" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.skyTop} />
            <stop offset="62%" stopColor={palette.skyBottom} />
            <stop offset="100%" stopColor={palette.haze} />
          </linearGradient>
          <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={palette.glow} stopOpacity="0.95" />
            <stop offset="35%" stopColor={palette.glow} stopOpacity="0.35" />
            <stop offset="100%" stopColor={palette.glow} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={hazeId} cx="50%" cy="95%" r="70%">
            <stop offset="0%" stopColor={palette.haze} stopOpacity="0.5" />
            <stop offset="100%" stopColor={palette.haze} stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="400" height="300" fill={`url(#${gradientId})`} />

        {stars.map((star, index) => (
          <circle key={index} cx={star.x} cy={star.y} r={star.r} fill={palette.snow} opacity={star.o} />
        ))}

        {/* Air, so the far buildings sit behind something rather than being cut out of it. */}
        <rect width="400" height="300" fill={`url(#${hazeId})`} />

        <g opacity="0.55">
          {far.map((b, index) => (
            <path key={index} d={buildingPath(b, 250, 0.62)} fill={palette.silhouette} />
          ))}
        </g>

        {/* The lamp's light, under the near silhouettes so it spills from behind them. */}
        <circle cx={lampX} cy={lampY} r="118" fill={`url(#${glowId})`} />

        <g>
          {near.map((b, index) => (
            <g key={index}>
              <path d={buildingPath(b, 300, 1)} fill={palette.silhouette} />
              {b.roof === "dome" && (
                <path
                  d={`M${b.x + b.width * 0.2} ${300 - b.height} Q${b.x + b.width / 2} ${300 - b.height - b.width * 0.62} ${b.x + b.width * 0.8} ${300 - b.height} Z`}
                  fill={palette.silhouette}
                />
              )}
              {b.roof === "spire" && (
                <path
                  d={`M${b.x + b.width * 0.42} ${300 - b.height} L${b.x + b.width / 2} ${300 - b.height - 34} L${b.x + b.width * 0.58} ${300 - b.height} Z`}
                  fill={palette.silhouette}
                />
              )}
              {b.windows.map((w, windowIndex) => (
                <rect
                  key={windowIndex}
                  x={w.x}
                  y={w.y}
                  width="3.4"
                  height="4.6"
                  rx="0.6"
                  fill={palette.window}
                  opacity={0.85}
                />
              ))}
            </g>
          ))}
        </g>

        {/* The lamp itself: post, arm, and a small fierce source. */}
        <g>
          <rect x={lampX - 1.4} y={lampY} width="2.8" height={300 - lampY} fill={palette.silhouette} />
          <path
            d={`M${lampX - 7} ${lampY} L${lampX - 4.5} ${lampY - 9} L${lampX + 4.5} ${lampY - 9} L${lampX + 7} ${lampY} Z`}
            fill={palette.silhouette}
          />
          <circle cx={lampX} cy={lampY - 4} r="3.4" fill={palette.window} />
          <circle cx={lampX} cy={lampY - 4} r="9" fill={palette.glow} opacity="0.4" />
        </g>

        {/* Snow on the ground, catching the lamp. */}
        <path d="M0 300 L0 284 Q100 272 200 282 Q300 292 400 278 L400 300 Z" fill={palette.snow} opacity="0.16" />
      </svg>

      <div className="cinema-scene__snow">
        {flakes.map((flake) => (
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

      <div className="cinema-scene__vignette" />
    </div>
  );
}
