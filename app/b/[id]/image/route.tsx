import { loadBokForShare } from "@/lib/boks/share-preview";
import { curtainCardFor } from "@/lib/boks/curtain";
import { curtainPoster } from "../curtain-render";

/**
 * A published bok's link preview: the curtain card, 1200x630 JPEG
 * (`lib/boks/curtain.tsx`). Rendered on the first request and kept in memory;
 * a new bok has its card the moment it is published.
 */
function publishedPoster(bytes: Uint8Array<ArrayBuffer>) {
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/jpeg",
      // Its length up front: a messenger may not download an image of unknown size.
      "Content-Length": String(bytes.byteLength),
      // The app owns the render cache. A CDN/browser hit must not bypass the
      // publication check below (including after an administrator hides a bok).
      "Cache-Control": "private, no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Check publication even for a cached image. Drafts and hidden boks have no poster.
  const bok = await loadBokForShare(id);
  if (!bok) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    return publishedPoster(await curtainPoster(curtainCardFor(bok), request));
  } catch (error) {
    console.error("Curtain poster rendering failed", error instanceof Error ? error.message : "Unknown render error");
    return new Response("Image unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
  }
}
