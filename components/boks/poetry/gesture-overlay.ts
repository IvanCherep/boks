import {
  attractTarget,
  autoFinger,
  coverTransform,
  flameLean,
  flareAmount,
  flingFrom,
  imageToScreen,
  isWarpGesture,
  lightNear,
  type FlareAmbience,
  type ImagePoint,
  type PoemGesture,
  type SceneAmbience,
} from "@/lib/boks/poetry/gesture";
import type { GestureFrame, GestureInput, GestureLayer } from "@/components/boks/poetry/gesture-layer";

/**
 * The gestures drawn over a picture rather than into it: an arrow and a song
 * let fly, threads to the lights and the bridge they make, a flame in the
 * wind, rain, the song coming home, falling leaves, a candle's light, snow,
 * and bees or flakes drawn to the finger.
 *
 * A transparent 2D canvas over the scene's `<img>`, cleared and drawn whole
 * every frame the scene is on screen. Everything is placed by the picture's
 * own coordinates through the same cover crop the `<img>` uses, so an arrow
 * leaves the archer's hand on any screen. Glow is built from wide, faint
 * strokes under narrow bright ones - `shadowBlur` is the one Canvas 2D
 * operation that turns a phone's frame into a slideshow.
 */

type Flight = { at: number; x: number; y: number; power: number };
type Retract = { at: number; x: number; y: number };

const gold = (alpha: number) => `rgba(255, 214, 140, ${alpha.toFixed(3)})`;
const silk = (alpha: number) => `rgba(226, 236, 255, ${alpha.toFixed(3)})`;

/** A small deterministic hash, so the rain is the same rain on every frame. */
function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function createOverlayLayer(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  scene: { gesture?: PoemGesture; ambience?: SceneAmbience; focalPoint: ImagePoint; startMs?: number },
  sceneIndex: number
): GestureLayer | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // A warp gesture is drawn into the picture by the WebGL layer, not here.
  const gesture = isWarpGesture(scene.gesture) ? undefined : scene.gesture;
  const ambience = scene.ambience;

  let width = 0;
  let height = 0;
  let transform = coverTransform({ width: 1, height: 1 }, { width: 1, height: 1 }, scene.focalPoint);
  const at = (point: ImagePoint) => {
    const s = imageToScreen(point, transform);
    return { x: s.x * width, y: s.y * height };
  };

  const flights: Flight[] = [];
  const held = new Set<number>();
  const retracting: Retract[] = [];
  let bridgeSince = 0;

  function resize() {
    // Soft glows and small particles look the same at 1.5x as at 2x, and a
    // full-screen canvas at 2x is twice the memory on the phones that have least.
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return false;
    if (w !== width || h !== height) {
      width = w;
      height = h;
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      transform = coverTransform(
        { width: w, height: h },
        { width: image.naturalWidth, height: image.naturalHeight },
        scene.focalPoint
      );
    }
    ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
    return true;
  }

  /** A glowing stroke: one wide faint pass, one narrow bright one. */
  function glowStroke(path: () => void, colour: (a: number) => string, alpha: number, line: number) {
    ctx!.lineCap = "round";
    ctx!.lineJoin = "round";
    for (const [scale, a] of [
      [5, 0.12],
      [2.4, 0.28],
      [1, 1],
    ] as const) {
      ctx!.beginPath();
      path();
      ctx!.strokeStyle = colour(alpha * a);
      ctx!.lineWidth = line * scale;
      ctx!.stroke();
    }
  }

  function glowDot(x: number, y: number, radius: number, colour: (a: number) => string, alpha: number) {
    const g = ctx!.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, colour(alpha));
    g.addColorStop(0.35, colour(alpha * 0.45));
    g.addColorStop(1, colour(0));
    ctx!.fillStyle = g;
    ctx!.beginPath();
    ctx!.arc(x, y, radius, 0, Math.PI * 2);
    ctx!.fill();
  }

  // ---------------------------------------------------------------- rain
  function rain(seconds: number, intensity: number, wind: number) {
    const count = Math.round(170 * intensity);
    const fall = height * 1.15;
    for (const bucket of [0, 1]) {
      ctx!.beginPath();
      for (let i = bucket; i < count; i += 2) {
        const speed = height * (1.5 + hash(i * 3) * 0.9);
        const length = 12 + hash(i * 7) * 16;
        const x = (hash(i) * 1.3 - 0.15) * width + seconds * speed * wind * 0.35;
        const y = ((hash(i * 5) * fall + seconds * speed) % fall) - height * 0.08;
        const wrapped = ((x % (width * 1.3)) + width * 1.3) % (width * 1.3) - width * 0.15;
        ctx!.moveTo(wrapped, y);
        ctx!.lineTo(wrapped + length * wind * 0.35, y + length);
      }
      ctx!.strokeStyle = `rgba(206, 216, 236, ${bucket ? 0.16 : 0.28})`;
      ctx!.lineWidth = bucket ? 0.8 : 1.1;
      ctx!.stroke();
    }
  }

  // -------------------------------------------------------------- leaves
  const leafColours = ["176, 92, 34", "201, 128, 46", "142, 70, 32", "214, 160, 72"];
  function leaves(seconds: number, count: number, sun?: ImagePoint) {
    // A low sun that shifts, under the leaves: warm, wide and never still.
    if (sun) {
      const s = at(sun);
      const breath = 0.5 + 0.5 * Math.sin(seconds * 0.21);
      glowDot(s.x + Math.sin(seconds * 0.07) * width * 0.03, s.y, Math.max(width, height) * 0.55, gold, 0.07 + 0.06 * breath);
    }
    const fall = height * 1.2;
    for (let i = 0; i < count; i += 1) {
      // Each leaf its own speed, sway and turn; the same leaf on every frame.
      const speed = height * (0.05 + hash(i * 3) * 0.05);
      const y = ((hash(i * 5) * fall + seconds * speed) % fall) - height * 0.1;
      const sway = Math.sin(seconds * (0.6 + hash(i * 11) * 0.7) + i) * width * (0.03 + hash(i * 13) * 0.04);
      const x = hash(i) * width + sway + seconds * width * 0.006;
      const wrapped = ((x % width) + width) % width;
      const size = 3.5 + hash(i * 7) * 5;
      const turn = seconds * (0.8 + hash(i * 17) * 1.6) + i;
      ctx!.save();
      ctx!.translate(wrapped, y);
      ctx!.rotate(turn);
      // A leaf turning in the air shows its edge, then its face.
      ctx!.scale(1, 0.25 + 0.75 * Math.abs(Math.sin(turn * 0.7)));
      ctx!.fillStyle = `rgba(${leafColours[i % leafColours.length]}, ${(0.55 + 0.35 * hash(i * 19)).toFixed(3)})`;
      ctx!.beginPath();
      ctx!.ellipse(0, 0, size, size * 0.45, 0, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.restore();
    }
  }

  // -------------------------------------------------------------- candle
  function candleGlow(seconds: number, point: ImagePoint, radius: number) {
    const c = at(point);
    const flicker = 0.07 * Math.sin(seconds * 9.7) + 0.05 * Math.sin(seconds * 17.3 + 1.1) + 0.04 * Math.sin(seconds * 3.1);
    const reach = (radius * width) / transform.scaleX;
    ctx!.save();
    ctx!.globalCompositeOperation = "lighter";
    glowDot(c.x + flicker * 4, c.y, reach * (1 + flicker), gold, 0.16 + flicker);
    glowDot(c.x, c.y, reach * 0.18, gold, 0.35 + flicker * 2);
    ctx!.restore();
  }

  // ----------------------------------------------------------- sky flare
  function skyFlare(seconds: number, ms: number | undefined, still: boolean, flare: FlareAmbience) {
    const into = ms === undefined ? flare.growMs : ms - (scene.startMs ?? 0);
    // Reduced motion: no growing and no breathing, the light simply there.
    const amount = still ? 0.7 : flareAmount(flare, into);
    if (amount <= 0) return;
    const c = at(flare.at);
    const reach = (flare.radius * width) / transform.scaleX;
    const [r, g, b] = flare.colour ?? [190, 255, 120];
    const tint = (alpha: number) => `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
    const hot = (alpha: number) => `rgba(250, 255, 225, ${alpha.toFixed(3)})`;
    const strength = flare.strength ?? 1;
    // A slow breath, and, as it gathers, a quicker throb under it; every few
    // seconds a surge, a flash that swells and falls back.
    const breath = still ? 1 : 1 + 0.14 * Math.sin(seconds * 1.9) + 0.07 * Math.sin(seconds * 4.7 + 1.3) + 0.1 * amount * Math.sin(seconds * 9.1);
    const surge = still ? 0 : amount * Math.pow(Math.max(0, Math.sin(seconds * 1.35)), 10);
    ctx!.save();
    ctx!.globalCompositeOperation = "lighter";
    glowDot(c.x, c.y, reach * (1.8 + 1.2 * amount + 0.8 * surge) * breath, tint, Math.min(1, strength * (0.2 * amount + 0.12 * surge)));
    glowDot(c.x, c.y, reach * (0.45 + 0.6 * amount + 0.3 * surge) * breath, tint, Math.min(1, strength * (0.5 * amount * breath + 0.3 * surge)));
    glowDot(c.x, c.y, reach * (0.1 + 0.16 * amount + 0.08 * surge), hot, Math.min(1, strength * amount * breath));
    ctx!.restore();
  }

  // --------------------------------------------------------------- flame
  function flame(seconds: number, hold: number, still: boolean, point: ImagePoint, size: number) {
    const centre = at(point);
    const tall = size * height / transform.scaleY;
    const lean = still ? (1 - hold) * 0.45 : flameLean(seconds, hold);
    const flicker = still ? 1 : 1 + (1 - hold * 0.7) * (0.07 * Math.sin(seconds * 13) + 0.05 * Math.sin(seconds * 23 + 2));
    const h = tall * flicker * (1 - 0.18 * lean);
    const w = tall * 0.26;
    const baseX = centre.x;
    const baseY = centre.y + tall * 0.42;
    // The light it throws, which steadies with it.
    glowDot(baseX + Math.sin(lean) * h * 0.4, baseY - h * 0.45, tall * 3.2, gold, 0.22 + 0.12 * hold);
    ctx!.save();
    ctx!.translate(baseX, baseY);
    ctx!.rotate(lean);
    ctx!.globalCompositeOperation = "lighter";
    const body = ctx!.createRadialGradient(0, -h * 0.28, 0, 0, -h * 0.35, h * 0.75);
    body.addColorStop(0, "rgba(255, 250, 225, 0.95)");
    body.addColorStop(0.25, "rgba(255, 214, 120, 0.8)");
    body.addColorStop(0.6, "rgba(255, 130, 40, 0.4)");
    body.addColorStop(1, "rgba(200, 60, 10, 0)");
    ctx!.fillStyle = body;
    ctx!.beginPath();
    ctx!.moveTo(0, 0);
    // Leaning, the tip trails further than the body: a flame in wind, not a
    // rotated candle.
    const trail = Math.sin(lean) * h * 0.35;
    ctx!.bezierCurveTo(-w, -h * 0.25, -w * 0.45 + trail * 0.4, -h * 0.75, trail, -h);
    ctx!.bezierCurveTo(w * 0.45 + trail * 0.4, -h * 0.75, w, -h * 0.25, 0, 0);
    ctx!.fill();
    ctx!.restore();
  }

  // ------------------------------------------------------- arrow and song
  function flightPath(origin: { x: number; y: number }, flight: Flight, u: number) {
    const reach = (0.45 + 0.6 * flight.power) * Math.max(width, height);
    const travelled = reach * (1 - Math.pow(1 - u, 2.2));
    return {
      x: origin.x + flight.x * travelled,
      // A little fall as it goes, so it flies rather than slides.
      y: origin.y + flight.y * travelled + height * 0.12 * flight.power * u * u,
    };
  }

  function arrowFlight(origin: { x: number; y: number }, flight: Flight, now: number) {
    const u = (now - flight.at) / 1700;
    if (u >= 1) return false;
    const head = flightPath(origin, flight, u);
    const tail = flightPath(origin, flight, Math.max(0, u - 0.06));
    const shrink = 1 - 0.85 * u;
    const alpha = u < 0.7 ? 1 : (1 - u) / 0.3;
    const trail = flightPath(origin, flight, Math.max(0, u - 0.22));
    glowStroke(() => {
      ctx!.moveTo(trail.x, trail.y);
      ctx!.lineTo(tail.x, tail.y);
    }, gold, alpha * 0.35, 1.2 * shrink);
    glowStroke(() => {
      ctx!.moveTo(tail.x, tail.y);
      ctx!.lineTo(head.x, head.y);
    }, (a) => `rgba(255, 246, 220, ${a.toFixed(3)})`, alpha, 1.8 * shrink + 0.4);
    glowDot(head.x, head.y, 9 * shrink + 2, gold, alpha);
    return true;
  }

  function wave(points: (s: number) => { x: number; y: number; nx: number; ny: number }, from: number, to: number, amplitude: (s: number) => number, phase: number, alpha: number, line: number) {
    glowStroke(() => {
      const steps = 40;
      for (let i = 0; i <= steps; i += 1) {
        const s = from + ((to - from) * i) / steps;
        const p = points(s);
        const offset = amplitude(s) * Math.sin(s * 34 - phase);
        const x = p.x + p.nx * offset;
        const y = p.y + p.ny * offset;
        if (i === 0) ctx!.moveTo(x, y);
        else ctx!.lineTo(x, y);
      }
    }, gold, alpha, line);
  }

  function songFlight(origin: { x: number; y: number }, flight: Flight, now: number) {
    const u = (now - flight.at) / 2600;
    if (u >= 1) return false;
    const along = (s: number) => {
      const p = flightPath(origin, flight, s);
      return { ...p, nx: -flight.y, ny: flight.x };
    };
    const alpha = u < 0.6 ? 1 : (1 - u) / 0.4;
    wave(along, Math.max(0, u - 0.4), u, (s) => 12 * (1 - s * 0.85), now / 120, alpha * 0.9, 2.2 * (1 - u * 0.7));
    const head = flightPath(origin, flight, u);
    glowDot(head.x, head.y, 10 * (1 - u * 0.7), gold, alpha * 0.8);
    return true;
  }

  function aim(origin: { x: number; y: number }, input: GestureInput, effect: "arrow" | "song") {
    const drag = input.drag;
    if (!drag || drag.scene !== sceneIndex) return;
    const shot = flingFrom({ x: drag.x0, y: drag.y0 }, { x: drag.x, y: drag.y }, width * 0.4, 8);
    if (!shot) return;
    const length = 40 + shot.power * width * 0.28;
    if (effect === "arrow") {
      glowStroke(() => {
        ctx!.setLineDash([6, 9]);
        ctx!.moveTo(origin.x, origin.y);
        ctx!.lineTo(origin.x + shot.x * length, origin.y + shot.y * length);
      }, gold, 0.35 + 0.5 * shot.power, 1.1);
      ctx!.setLineDash([]);
    } else {
      wave(
        (s) => ({ x: origin.x + shot.x * length * s, y: origin.y + shot.y * length * s, nx: -shot.y, ny: shot.x }),
        0,
        1,
        () => 4 + 6 * shot.power,
        performance.now() / 140,
        0.35 + 0.5 * shot.power,
        1.4
      );
    }
    glowDot(origin.x, origin.y, 10 + 14 * shot.power, gold, 0.4 + 0.5 * shot.power);
  }

  // ---------------------------------------------------------------- snow
  /*
   * Flakes keep their own place in a falling field, the same flake on every
   * frame. A finger is a light: flakes near it are pulled out of the field
   * towards it and warm to amber, then fall back into place when it lifts.
   * Two batched paths a frame (cold and warm), no gradients per flake.
   */
  const pulls = new Float32Array(512 * 2);
  function snow(seconds: number, count: number, wind: number, light: ImagePoint | undefined, finger: { x: number; y: number } | null, heldMs: number, elapsed: number) {
    const fall = height * 1.1;
    const lamp = light ? at(light) : null;
    const reach = Math.max(width, height) * 0.32;
    const gather = finger ? Math.min(1, heldMs / 1400) : 0;
    if (finger) glowDot(finger.x, finger.y, reach * (0.35 + 0.25 * gather), gold, 0.18 + 0.2 * gather);
    if (lamp) glowDot(lamp.x, lamp.y, reach * 0.55, gold, 0.1 + 0.03 * Math.sin(seconds * 1.3));
    const ease = 1 - Math.exp(-elapsed / 260);
    const cold: number[] = [];
    const warm: number[] = [];
    for (let i = 0; i < Math.min(count, 512); i += 1) {
      const speed = height * (0.035 + hash(i * 3) * 0.05);
      const size = 0.8 + hash(i * 7) * 2.2;
      const y = ((hash(i * 5) * fall + seconds * speed * (0.6 + size * 0.25)) % fall) - height * 0.05;
      const sway = Math.sin(seconds * (0.5 + hash(i * 11)) + i) * width * 0.02;
      const x0 = hash(i) * width * 1.2 - width * 0.1 + sway + seconds * width * 0.01 * wind;
      const x = ((x0 % (width * 1.2)) + width * 1.2) % (width * 1.2) - width * 0.1;
      // How far the flake has been drawn off its place, eased both ways.
      let px = pulls[i * 2];
      let py = pulls[i * 2 + 1];
      let tx = 0;
      let ty = 0;
      let heat = 0;
      if (finger) {
        const dx = finger.x - x;
        const dy = finger.y - y;
        const d = Math.hypot(dx, dy);
        if (d < reach) {
          const k = (1 - d / reach) * (0.55 + 0.4 * gather);
          tx = dx * k;
          ty = dy * k;
          heat = k;
        }
      }
      if (lamp) heat = Math.max(heat, 0.6 * Math.max(0, 1 - Math.hypot(lamp.x - x, lamp.y - y) / (reach * 0.7)));
      px += (tx - px) * ease;
      py += (ty - py) * ease;
      pulls[i * 2] = px;
      pulls[i * 2 + 1] = py;
      (heat > 0.25 ? warm : cold).push(x + px, y + py, size * (1 + heat * 0.6));
    }
    for (const [list, colour] of [
      [cold, "rgba(236, 242, 255, 0.78)"],
      [warm, "rgba(255, 210, 140, 0.92)"],
    ] as const) {
      ctx!.fillStyle = colour;
      ctx!.beginPath();
      for (let k = 0; k < list.length; k += 3) {
        ctx!.moveTo(list[k] + list[k + 2], list[k + 1]);
        ctx!.arc(list[k], list[k + 1], list[k + 2], 0, Math.PI * 2);
      }
      ctx!.fill();
    }
  }

  // ---------------------------------------------------------------- bees
  /*
   * Bees idle round their home, each on its own small loop. Down, they come
   * to the finger and wind tighter and faster round it: the humming ball,
   * glowing more the longer it is held. Up, the ball bursts outwards and the
   * bees find their way home. Positions are eased, never teleported.
   */
  const bees = new Float32Array(128 * 4);
  let beesReady = false;
  let burstAt = 0;
  let lastFinger: { x: number; y: number } | null = null;
  let lastHeld = 0;
  function swarm(now: number, seconds: number, count: number, home: ImagePoint, finger: { x: number; y: number } | null, heldMs: number, elapsed: number) {
    const n = Math.min(count, 128);
    const base = at(home);
    const scale = Math.min(width, height);
    if (!beesReady) {
      for (let i = 0; i < n; i += 1) {
        bees[i * 4] = base.x + (hash(i) - 0.5) * scale * 0.3;
        bees[i * 4 + 1] = base.y + (hash(i * 9) - 0.5) * scale * 0.3;
      }
      beesReady = true;
    }
    if (!finger && lastFinger && lastHeld > 250) {
      burstAt = now;
      for (let i = 0; i < n; i += 1) {
        const a = hash(i * 13) * Math.PI * 2;
        bees[i * 4 + 2] = Math.cos(a) * scale * (0.6 + hash(i) * 0.8);
        bees[i * 4 + 3] = Math.sin(a) * scale * (0.6 + hash(i) * 0.8);
      }
    }
    lastFinger = finger;
    lastHeld = heldMs;
    const gather = finger ? Math.min(1, heldMs / 1800) : 0;
    if (finger) {
      // The ball's own light, and the hum: rings that tremble round it.
      const breathe = 0.5 + 0.5 * Math.sin(now / 70);
      glowDot(finger.x, finger.y, scale * (0.2 + 0.28 * gather), gold, 0.25 + 0.45 * gather);
      glowDot(finger.x, finger.y, scale * (0.05 + 0.05 * gather), (a) => `rgba(255, 246, 214, ${a.toFixed(3)})`, 0.35 + 0.5 * gather * breathe);
      for (let ring = 0; ring < 3; ring += 1) {
        const r = scale * (0.1 + 0.05 * ring) * (1 - 0.35 * gather) + Math.sin(now / (40 + ring * 13)) * 2.5;
        ctx!.beginPath();
        ctx!.arc(finger.x, finger.y, Math.max(4, r), 0, Math.PI * 2);
        ctx!.strokeStyle = gold(gather * (0.7 - ring * 0.18));
        ctx!.lineWidth = 1.6;
        ctx!.stroke();
      }
    }
    const dt = elapsed / 1000;
    const bursting = now - burstAt < 900;
    const follow = 1 - Math.exp(-elapsed / (finger ? 140 : 520));
    const drawn: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const loop = seconds * (0.7 + hash(i * 5) * 0.9) + i;
      const idle = {
        x: base.x + Math.cos(loop) * scale * (0.06 + hash(i * 2) * 0.16) + Math.sin(loop * 2.3) * scale * 0.015,
        y: base.y + Math.sin(loop * 1.3) * scale * (0.05 + hash(i * 4) * 0.1),
      };
      const target = attractTarget(idle, finger, heldMs, i, seconds, scale);
      let x = bees[i * 4];
      let y = bees[i * 4 + 1];
      if (bursting) {
        x += bees[i * 4 + 2] * dt * (1 - (now - burstAt) / 900);
        y += bees[i * 4 + 3] * dt * (1 - (now - burstAt) / 900);
      } else {
        x += (target.x - x) * follow;
        y += (target.y - y) * follow;
      }
      // Facing where it flies.
      const heading = Math.atan2(y - bees[i * 4 + 1], x - bees[i * 4]) || 0;
      bees[i * 4] = x;
      bees[i * 4 + 1] = y;
      drawn.push(x, y, 3.6 + hash(i * 17) * 2.4, heading);
    }
    // Three batched passes - wings, bodies, stripes - like the woodcut's own bees.
    const flap = (i: number) => 0.55 + 0.45 * Math.abs(Math.sin(now / 18 + i * 1.7));
    ctx!.fillStyle = "rgba(250, 248, 238, 0.82)";
    ctx!.beginPath();
    for (let k = 0, i = 0; k < drawn.length; k += 4, i += 1) {
      const [x, y, size] = [drawn[k], drawn[k + 1], drawn[k + 2]];
      const w = size * 0.9 * flap(i);
      ctx!.moveTo(x - size * 0.2 + w, y - size * 0.75);
      ctx!.ellipse(x - size * 0.2, y - size * 0.75, w, size * 0.45, -0.5, 0, Math.PI * 2);
      ctx!.moveTo(x + size * 0.3 + w, y - size * 0.7);
      ctx!.ellipse(x + size * 0.3, y - size * 0.7, w, size * 0.45, 0.5, 0, Math.PI * 2);
    }
    ctx!.fill();
    ctx!.fillStyle = "rgba(236, 170, 40, 0.98)";
    ctx!.beginPath();
    for (let k = 0; k < drawn.length; k += 4) {
      const [x, y, size, heading] = [drawn[k], drawn[k + 1], drawn[k + 2], drawn[k + 3]];
      ctx!.moveTo(x + size * 1.25, y);
      ctx!.ellipse(x, y, size * 1.25, size * 0.75, heading, 0, Math.PI * 2);
    }
    ctx!.fill();
    ctx!.strokeStyle = "rgba(30, 18, 6, 0.95)";
    ctx!.lineWidth = 1.3;
    ctx!.beginPath();
    for (let k = 0; k < drawn.length; k += 4) {
      const [x, y, size, heading] = [drawn[k], drawn[k + 1], drawn[k + 2], drawn[k + 3]];
      const c = Math.cos(heading + Math.PI / 2) * size * 0.72;
      const d = Math.sin(heading + Math.PI / 2) * size * 0.72;
      for (const t of [-0.35, 0.25]) {
        const ox = Math.cos(heading) * size * t;
        const oy = Math.sin(heading) * size * t;
        ctx!.moveTo(x + ox - c, y + oy - d);
        ctx!.lineTo(x + ox + c, y + oy + d);
      }
    }
    ctx!.stroke();
  }

  // ------------------------------------------------- the song comes home
  function returningSong(now: number, from: ImagePoint, to: ImagePoint, input: GestureInput) {
    const start = at(from);
    const end = at(to);
    const control = { x: (start.x + end.x) / 2, y: Math.min(start.y, end.y) - height * 0.12 };
    const point = (s: number) => {
      const x = (1 - s) * (1 - s) * start.x + 2 * (1 - s) * s * control.x + s * s * end.x;
      const y = (1 - s) * (1 - s) * start.y + 2 * (1 - s) * s * control.y + s * s * end.y;
      const dx = 2 * (1 - s) * (control.x - start.x) + 2 * s * (end.x - control.x);
      const dy = 2 * (1 - s) * (control.y - start.y) + 2 * s * (end.y - control.y);
      const n = Math.hypot(dx, dy) || 1;
      return { x, y, nx: -dy / n, ny: dx / n };
    };
    const cycle = 6500;
    const t = (now % cycle) / 3400;
    // Brighter for a reader who sent a song away earlier in the poem.
    const strength = input.flown > 0 ? 1 : 0.75;
    if (t <= 1) {
      // From far away and small, growing as it comes near.
      wave(point, Math.max(0, t - 0.4), t, (s) => 3 + 9 * s, now / 130, strength * Math.min(1, t * 4), 1 + 1.6 * t);
      const head = point(t);
      glowDot(head.x, head.y, 6 + 8 * t, gold, strength * 0.8);
    } else {
      const after = (t - 1) * 3400;
      if (after < 1400) glowDot(end.x, end.y, 18 + after / 40, gold, strength * 0.7 * (1 - after / 1400));
    }
  }

  // ------------------------------------------------- threads and the bridge
  function threadCurve(a: { x: number; y: number }, b: { x: number; y: number }, sag: number) {
    ctx!.moveTo(a.x, a.y);
    ctx!.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + sag, b.x, b.y);
  }

  function threads(now: number, input: GestureInput, anchorPoint: ImagePoint, lightPoints: ImagePoint[], bridgeAfter: number) {
    const anchor = at(anchorPoint);
    const lights = lightPoints.map(at);
    const reach = width * 0.11;

    // A thread let go: it holds on a light, or springs back to where it began.
    for (let i = input.releases.length - 1; i >= 0; i -= 1) {
      const release = input.releases[i];
      if (release.scene !== sceneIndex) continue;
      input.releases.splice(i, 1);
      const hit = lightNear({ x: release.x, y: release.y }, lights, reach);
      if (hit >= 0 && !held.has(hit)) {
        held.add(hit);
        input.connections += 1;
      } else retracting.push({ at: now, x: release.x, y: release.y });
    }

    const pulse = 0.5 + 0.5 * Math.sin(now / 520);
    lights.forEach((light, index) => {
      const on = held.has(index);
      glowDot(light.x, light.y, on ? 26 : 14 + 4 * pulse, silk, on ? 0.95 : 0.5 + 0.25 * pulse);
    });
    held.forEach((index) => {
      const light = lights[index];
      glowStroke(() => threadCurve(anchor, light, height * 0.03), silk, 0.7 + 0.2 * Math.sin(now / 300 + index), 0.9);
    });

    const drag = input.drag;
    if (drag && drag.scene === sceneIndex) {
      const near = lightNear({ x: drag.x, y: drag.y }, lights, reach);
      if (near >= 0) glowDot(lights[near].x, lights[near].y, 34, silk, 0.6);
      glowStroke(() => threadCurve(anchor, { x: drag.x, y: drag.y }, height * 0.02), silk, 0.85, 0.9);
    }
    for (let i = retracting.length - 1; i >= 0; i -= 1) {
      const back = retracting[i];
      const u = (now - back.at) / 450;
      if (u >= 1) {
        retracting.splice(i, 1);
        continue;
      }
      const end = { x: back.x + (anchor.x - back.x) * u, y: back.y + (anchor.y - back.y) * u };
      glowStroke(() => threadCurve(anchor, end, height * 0.02 * (1 - u)), silk, 0.7 * (1 - u), 0.9);
    }
    glowDot(anchor.x, anchor.y, 12, silk, 0.6);

    // The bridge: every light joined, anchor first, in a luminous span.
    if (input.connections >= bridgeAfter) {
      if (!bridgeSince) bridgeSince = now;
      const shown = Math.min(1, (now - bridgeSince) / 1800);
      const chain = [anchor, ...[...lights].sort((a, b) => a.x - b.x)];
      glowStroke(() => {
        for (let i = 1; i < chain.length; i += 1) threadCurve(chain[i - 1], chain[i], -height * 0.04);
      }, gold, 0.85 * shown, 1.6);
      for (let i = 1; i < chain.length; i += 1) {
        const a = chain[i - 1];
        const b = chain[i];
        const s = ((now / 1400 + i * 0.37) % 1) * shown;
        glowDot(a.x + (b.x - a.x) * s, a.y + (b.y - a.y) * s - height * 0.04 * 4 * s * (1 - s) * 0.5, 7, gold, shown);
      }
    } else bridgeSince = 0;
  }

  // --------------------------------------------------------------- frame
  let fingerSince = 0;
  let lastNow = 0;
  const paint = (frame: GestureFrame, input?: GestureInput) => {
    if (!input || !resize()) return;
    const now = frame.now;
    const elapsed = lastNow ? Math.min(100, now - lastNow) : 16;
    lastNow = now;
    ctx.clearRect(0, 0, width, height);
    const real = input.drag && input.drag.scene === sceneIndex ? { x: input.drag.x, y: input.drag.y } : null;
    if (real && !fingerSince) fingerSince = now;
    if (!real) fingerSince = 0;
    let touch = real;
    let heldMs = real ? now - fingerSince : 0;
    // Nobody touching: a self-playing gesture moves its own invisible hand.
    if (!real && !frame.still && gesture?.kind === "attract" && gesture.auto && frame.ms !== undefined) {
      const ghost = autoFinger(gesture.auto, frame.ms - (scene.startMs ?? 0), gesture.home ?? scene.focalPoint);
      if (ghost) {
        touch = at(ghost);
        heldMs = ghost.heldMs;
      }
    }

    if (ambience?.effect === "rain" && !frame.still) rain(frame.time, ambience.intensity, ambience.wind);
    if (ambience?.effect === "returning-song" && !frame.still) returningSong(now, ambience.from, ambience.to, input);
    if (ambience?.effect === "falling-leaves" && !frame.still) leaves(frame.time, ambience.count, ambience.sun);
    if (ambience?.effect === "candle-glow") candleGlow(frame.time, ambience.at, ambience.radius);
    if (ambience?.effect === "sky-flare") skyFlare(frame.time, frame.ms, frame.still, ambience);
    if (ambience?.effect === "snow" && !frame.still) snow(frame.time, ambience.count, ambience.wind, ambience.light, null, 0, elapsed);
    if (gesture?.kind === "attract") {
      // Nothing is let go of here: the swarm or the snow follows the finger itself.
      for (let i = input.releases.length - 1; i >= 0; i -= 1) if (input.releases[i].scene === sceneIndex) input.releases.splice(i, 1);
    }
    if (gesture?.kind === "attract" && gesture.effect === "snow") {
      snow(frame.still ? 0 : frame.time, gesture.count, 0.4, gesture.home, touch, heldMs, elapsed);
    }
    if (gesture?.kind === "attract" && gesture.effect === "bees") {
      swarm(now, frame.still ? 0 : frame.time, gesture.count, gesture.home ?? scene.focalPoint, touch, heldMs, elapsed);
    }

    if (gesture?.kind === "hold" && gesture.effect === "shelter-flame") {
      flame(frame.time, frame.hold, frame.still, gesture.flame, gesture.size);
    } else if (gesture?.kind === "fling") {
      const origin = at(gesture.origin);
      for (let i = input.releases.length - 1; i >= 0; i -= 1) {
        const release = input.releases[i];
        if (release.scene !== sceneIndex) continue;
        input.releases.splice(i, 1);
        const shot = flingFrom({ x: release.x0, y: release.y0 }, { x: release.x, y: release.y }, width * 0.4);
        if (!shot) continue;
        flights.push({ at: now, x: shot.x, y: shot.y, power: shot.power });
        if (gesture.effect === "song") input.flown += 1;
      }
      aim(origin, input, gesture.effect);
      for (let i = flights.length - 1; i >= 0; i -= 1) {
        const alive = gesture.effect === "arrow" ? arrowFlight(origin, flights[i], now) : songFlight(origin, flights[i], now);
        if (!alive) flights.splice(i, 1);
      }
    } else if (gesture?.kind === "threads") {
      threads(now, input, gesture.anchor, gesture.lights, gesture.bridgeAfter);
    }
  };

  return { paint, dispose: () => ctx.clearRect(0, 0, canvas.width, canvas.height) };
}
