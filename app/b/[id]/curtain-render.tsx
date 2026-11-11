import { ImageResponse } from "next/og";
import { CurtainScene, curtainFonts, curtainLoopSize, curtainOverlay, curtainPosterSize, jpegSize, type CurtainCard } from "@/lib/boks/curtain";
import { posterPngToJpeg } from "@/lib/boks/poster-jpeg";
import { storedCurtainPoster } from "@/lib/boks/curtain-loop";

import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";

/**
 * Renders the curtain card (`lib/boks/curtain.tsx`) for the `/b/<id>` image
 * routes. Only application-owned paths are read (fonts, the shared overlay, a
 * registered cover): from the release's own `public/` on disk, which the
 * server job also relies on when it calls a copy directly, else from this
 * origin.
 */
export async function asset(path: string, request: Request): Promise<ArrayBuffer> {
  const local = normalize(join(process.cwd(), "public", path));
  if (local.startsWith(join(process.cwd(), "public"))) {
    try {
      const bytes = await readFile(local);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    } catch {
      // Not on disk (a dev server): fetch it.
    }
  }
  const response = await fetch(new URL(path, request.url), { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error("Curtain asset unavailable");
  return response.arrayBuffer();
}

type Font = { name: string; data: ArrayBuffer; weight: 400; style: "normal" };
let fonts: Promise<Font[]> | undefined;
let overlay: Promise<string> | undefined;

function loadFonts(request: Request) {
  fonts ??= Promise.all([
    asset(curtainFonts.title, request).then((data) => ({ name: "CurtainTitle", data, weight: 400 as const, style: "normal" as const })),
    asset(curtainFonts.byline, request).then((data) => ({ name: "CurtainSans", data, weight: 400 as const, style: "normal" as const })),
  ]).catch((error) => {
    fonts = undefined;
    throw error;
  });
  return fonts;
}

function loadOverlay(request: Request) {
  overlay ??= asset(curtainOverlay, request)
    .then((data) => `data:image/png;base64,${Buffer.from(data).toString("base64")}`)
    .catch((error) => {
      overlay = undefined;
      throw error;
    });
  return overlay;
}

async function loadArtwork(card: CurtainCard, request: Request) {
  if (!card.art) return undefined;
  try {
    const bytes = new Uint8Array(await asset(card.art, request));
    const size = jpegSize(bytes);
    return size ? { url: `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`, ...size } : undefined;
  } catch {
    return undefined; // a missing cover gets the plain ground, not a failed card
  }
}

/**
 * Rendered images, kept in memory on the Node server, keyed by the card's key
 * (which changes with anything drawn). The publication check in each route
 * runs before this, on every request.
 */
const memory = new Map<string, { bytes: Uint8Array<ArrayBuffer>; at: number }>();
const memoryLimit = 300;
const memoryTtlMs = 6 * 60 * 60 * 1000;

/**
 * Drawing a card holds the event loop for a good part of a second (resvg, then
 * the pure-JavaScript JPEG encoder). Messengers fetch a new link's image from
 * several crawlers at once, and a busy loop also delays the copy's /__health,
 * which takes it out of rotation. So: one render at a time per process, the
 * same card is drawn once however many ask for it, and past a short queue a
 * request gets 503 (the route says Retry-After) instead of waiting.
 */
const inFlight = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
const queueLimit = 12;
let queued = 0;
let tail: Promise<unknown> = Promise.resolve();

export class CurtainBusyError extends Error {
  constructor() {
    super("Curtain render queue is full");
  }
}

function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  if (queued >= queueLimit) return Promise.reject(new CurtainBusyError());
  queued += 1;
  const run = tail.then(work).finally(() => {
    queued -= 1;
  });
  tail = run.catch(() => undefined);
  return run;
}

async function remembered(
  key: string,
  render: () => Promise<Uint8Array<ArrayBuffer>>,
  stored?: () => Promise<Uint8Array<ArrayBuffer> | null>
) {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < memoryTtlMs) return hit.bytes;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const drawing = (stored ? stored() : Promise.resolve(null))
    .then((bytes) => bytes ?? oneAtATime(render))
    .then((bytes) => {
      memory.delete(key);
      memory.set(key, { bytes, at: Date.now() });
      while (memory.size > memoryLimit) memory.delete(memory.keys().next().value!);
      return bytes;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, drawing);
  return drawing;
}

/** The 1200x630 JPEG for og:image. */
export function curtainPoster(card: CurtainCard, request: Request) {
  return remembered(`poster:${card.id}:${card.key}`, async () => {
    const [loadedFonts, artwork, curtain] = await Promise.all([loadFonts(request), loadArtwork(card, request), loadOverlay(request)]);
    const rendered = new ImageResponse(<CurtainScene card={card} layer="poster" width={curtainPosterSize.width} artwork={artwork} overlay={curtain} />, { ...curtainPosterSize, fonts: loadedFonts });
    // JPEG: a fifth of the PNG, which a messenger otherwise gives up on (`poster-jpeg.ts`).
    return posterPngToJpeg(await rendered.arrayBuffer(), 85);
  }, () => storedCurtainPoster(card));
}

/** A 960x504 PNG layer for the loop job: the cover alone, or the text alone on transparency. */
export function curtainLayer(card: CurtainCard, layer: "art" | "text", request: Request) {
  return remembered(`${layer}:${card.id}:${card.key}`, async () => {
    const [loadedFonts, artwork] = await Promise.all([loadFonts(request), layer === "art" ? loadArtwork(card, request) : undefined]);
    const rendered = new ImageResponse(<CurtainScene card={card} layer={layer} width={curtainLoopSize.width} artwork={artwork} />, { ...curtainLoopSize, fonts: loadedFonts });
    return new Uint8Array(await rendered.arrayBuffer());
  });
}
