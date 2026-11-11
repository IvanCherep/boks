import { asset } from "@/app/b/[id]/curtain-render";
import { ribbonJobCard, serveRibbonFile, type RibbonCard } from "@/lib/boks/ribbon";

/**
 * The files under a ribbon card's page (`/b/<id>/ribbon/<file>`,
 * `/a/<handle>/ribbon/<file>`), the card already loaded through the page's own
 * publication check:
 *   card        what the job draws (JSON), for the job
 *   art         the cover itself, for the job
 *   poster.jpg  the stored 1200x630 poster, og:image
 *   loop.mp4    the stored 960x504 loop, og:video
 */
export async function ribbonFileResponse(card: RibbonCard | null, file: string, request: Request) {
  const none = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
  if (!card) return none();
  if (file === "card") {
    return Response.json(ribbonJobCard(card), { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
  }
  if (file === "art") {
    if (!card.art) return none();
    try {
      const bytes = await asset(card.art, request);
      return new Response(bytes, {
        headers: { "Content-Type": "application/octet-stream", "Content-Length": String(bytes.byteLength), "Cache-Control": "no-store", "X-Ribbon-Key": card.key, "X-Robots-Tag": "noindex, nofollow" },
      });
    } catch {
      return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
    }
  }
  if (file === "poster.jpg" || file === "loop.mp4") return serveRibbonFile(card, file, request);
  return none();
}
