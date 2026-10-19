import { env } from "cloudflare:workers";
import { ImageResponse } from "next/og";
import { getBokArtwork } from "@/components/boks/reader/bok-artwork";
import { loadBokForShare } from "@/lib/boks/share-preview";
import { SharePoster, sharePosterSize } from "@/lib/boks/share-poster";
import { sharePosterVersion } from "@/lib/boks/share-link";

async function asset(path: string, request: Request) {
  const binding = (env as { ASSETS?: Fetcher }).ASSETS;
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
  const cache = (caches as CacheStorage & { default?: Cache }).default;
  const key = new Request(new URL(`/b/${bok.id}/image?v=${sharePosterVersion}`, request.url));
  const cached = await cache?.match(key);
  if (cached) return publishedPoster(cached);
  try {
    const cover = getBokArtwork({ id: bok.id });
    const [loadedFonts, image] = await Promise.all([
      posterFonts(request),
      cover ? asset(cover.replace("/series/", "/share/art/").replace(/\.webp$/u, ".jpg"), request) : undefined,
    ]);
    const artwork = image ? `data:image/jpeg;base64,${Buffer.from(image).toString("base64")}` : undefined;
    const rendered = new ImageResponse(<SharePoster bok={bok} artwork={artwork} />, { ...sharePosterSize, fonts: loadedFonts });
    // Await the renderer so a failed stream cannot become a cached 200 image.
    const response = new Response(await rendered.arrayBuffer(), { headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    } });
    await cache?.put(key, response.clone());
    return publishedPoster(response);
  } catch (error) {
    console.error("Share poster rendering failed", error instanceof Error ? error.message : "Unknown render error");
    return new Response("Image unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
  }
}
