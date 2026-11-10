import { loadBokForShare } from "@/lib/boks/share-preview";
import { curtainCardFor } from "@/lib/boks/curtain";
import { curtainPoster } from "../curtain-render";

/**
 * A published bok's link preview: the curtain card, 1200x630 JPEG
 * (`lib/boks/curtain.tsx`). The copy stored by the server job when there is
 * one, else rendered on the first request; kept in memory either way. A new
 * bok has its card the moment it is published.
 */
function publishedPoster(bytes: Uint8Array<ArrayBuffer>, key: string) {
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/jpeg",
      // Which card this is: the job stores it under this key (`deploy/curtain/`).
      "X-Curtain-Key": key,
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
    const card = curtainCardFor(bok);
    return publishedPoster(await curtainPoster(card, request), card.key);
  } catch (error) {
    console.error("Curtain poster rendering failed", error instanceof Error ? error.message : "Unknown render error");
    return new Response("Image unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
  }
}
