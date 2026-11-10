import { loadBokForShare } from "@/lib/boks/share-preview";
import { curtainCardFor } from "@/lib/boks/curtain";
import { curtainLayer } from "../../curtain-render";

/**
 * The two 960x504 layers the loop job (`deploy/curtain/`) lays the shared
 * curtain phases between: `art.png`, the cover alone, and `text.png`, the
 * title and byline on transparency; `key`, the card's key alone, which names
 * the loop and tells the job whether its loop is still current.
 * Published boks only; nothing else in the path is read.
 */
const layers = { "art.png": "art", "text.png": "text", key: "key" } as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string; layer: string }> }) {
  const { id, layer } = await params;
  const kind = Object.prototype.hasOwnProperty.call(layers, layer) ? layers[layer as keyof typeof layers] : null;
  const bok = kind ? await loadBokForShare(id) : null;
  if (!kind || !bok) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const card = curtainCardFor(bok);
  if (kind === "key") return new Response(card.key, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", "X-Curtain-Key": card.key } });
  try {
    const bytes = await curtainLayer(card, kind, request);
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Curtain-Key": card.key,
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    console.error("Curtain layer rendering failed", error instanceof Error ? error.message : "Unknown render error");
    return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
  }
}
