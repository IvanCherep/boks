import { ImageResponse } from "next/og";
import { getBokPosterArtwork } from "@/components/boks/reader/bok-artwork";
import { loadBokForShare } from "@/lib/boks/share-preview";
import { SharePoster, sharePosterSize } from "@/lib/boks/share-poster";
import { sharePosterVersion } from "@/lib/boks/share-link";
import { posterPngToJpeg } from "@/lib/boks/poster-jpeg";

async function asset(path: string, request: Request) {
  // On Cloudflare the static-assets binding is on globalThis via the Workers env;
  // on Node there is none and the owned path is fetched from this same origin.
  const binding = (globalThis as { __BOKS_ASSETS__?: Fetcher }).__BOKS_ASSETS__;
  // Only application-owned paths enter this function. No request parameter is
  // used as an image/font URL; production reads the static-assets binding.
  const response = binding
    ? await binding.fetch(new Request(new URL(path, "https://assets.local")))
    : await fetch(new URL(path, request.url), { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error("Share asset unavailable");
  return response.arrayBuffer();
}

let fonts: Promise<Array<{ name: string; data: ArrayBuffer; weight: 400; style: "italic" | "normal" }>> | undefined;

function posterFonts(request: Request) {
  fonts ??= Promise.all([
    asset("/share/fonts/source-serif-4-italic.ttf", request).then(data => ({ name: "PosterSerif", data, weight: 400 as const, style: "italic" as const })),
    asset("/share/fonts/noto-sans.ttf", request).then(data => ({ name: "PosterSans", data, weight: 400 as const, style: "normal" as const })),
  ]).catch(error => { fonts = undefined; throw error; });
  return fonts;
}

/**
 * Rendered posters, kept in memory on the Node server (Workers have
 * `caches.default`; Node has nothing, so every request drew the poster again,
 * about two seconds - longer than Telegram waits). Keyed by bok and poster
 * version; the publication check above still runs on every request, so a
 * hidden bok's poster is never served from here.
 */
const memory = new Map<string, { bytes: Uint8Array<ArrayBuffer>; at: number }>();
const memoryLimit = 300;
const memoryTtlMs = 6 * 60 * 60 * 1000;

function remembered(key: string) {
  const hit = memory.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > memoryTtlMs) { memory.delete(key); return null; }
  return hit.bytes;
}

function remember(key: string, bytes: Uint8Array<ArrayBuffer>) {
  memory.delete(key);
  memory.set(key, { bytes, at: Date.now() });
  while (memory.size > memoryLimit) memory.delete(memory.keys().next().value!);
}

function jpegResponse(bytes: Uint8Array<ArrayBuffer>) {
  return new Response(bytes, { headers: {
    "Content-Type": "image/jpeg",
    // Its length up front: a messenger may not download an image of unknown size.
    "Content-Length": String(bytes.byteLength),
    "Cache-Control": "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
  } });
}

function publishedPoster(response: Response) {
  const headers = new Headers(response.headers);
  // The Worker owns the render cache. A CDN/browser hit must not bypass the
  // publication check above (including after an administrator hides a bok).
  headers.set("Cache-Control", "private, no-store");
  headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  return new Response(response.body, { headers });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Check publication even for a cached image. Drafts and hidden boks have no poster.
  const bok = await loadBokForShare(id);
  if (!bok) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  // `caches.default` exists only in Workers; on Node the poster is rendered per request.
  const cache = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches?.default;
  const key = new Request(new URL(`/b/${bok.id}/image?v=${sharePosterVersion}`, request.url));
  const cached = await cache?.match(key);
  if (cached) return publishedPoster(cached);
  const inMemory = remembered(key.url);
  if (inMemory) return publishedPoster(jpegResponse(inMemory));
  try {
    const cover = getBokPosterArtwork(bok.id);
    const [loadedFonts, image] = await Promise.all([
      posterFonts(request),
      cover ? asset(cover, request) : undefined,
    ]);
    const artwork = image ? `data:image/jpeg;base64,${Buffer.from(image).toString("base64")}` : undefined;
    const rendered = new ImageResponse(<SharePoster bok={bok} artwork={artwork} />, { ...sharePosterSize, fonts: loadedFonts });
    // Await the renderer so a failed stream cannot become a cached 200 image.
    // JPEG: a fifth of the PNG, which a messenger otherwise gives up on (`poster-jpeg.ts`).
    const bytes = posterPngToJpeg(await rendered.arrayBuffer());
    remember(key.url, bytes);
    const response = jpegResponse(bytes);
    await cache?.put(key, response.clone());
    return publishedPoster(response);
  } catch (error) {
    console.error("Share poster rendering failed", error instanceof Error ? error.message : "Unknown render error");
    return new Response("Image unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
  }
}
