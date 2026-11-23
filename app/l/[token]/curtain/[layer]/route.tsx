import { curtainCardForPiece } from "@/lib/boks/curtain";
import { preparedCurtainUrl } from "@/lib/boks/curtain-loop";
import { isLinkOnlyToken } from "@/lib/boks/link-only";
import { linkOnlyHeading } from "@/lib/boks/link-only-heading";
import { CurtainBusyError, curtainLayer, curtainPoster } from "@/app/b/[id]/curtain-render";

/**
 * A Series piece's link preview, made before its author publishes it
 * (`docs/link-only-pieces.md`, "Previews ahead of publication"):
 *
 *   - `key`, `art.png`, `text.png`: what the loop job (`deploy/curtain/`)
 *     needs to make `curtain/prepared/<token>-<look>.mp4`, the same three
 *     answers `/b/<id>/curtain/<layer>` gives for a published bok;
 *   - `image.jpg`: the 1200x630 poster (stored by the job, else drawn);
 *   - `loop.mp4`: the prepared loop, for the team's own materials.
 *
 * The card is the one the bok will have once published with the same title
 * and byline (`curtainCardForPiece`), so the bok shows these at once. As with
 * the piece itself, the token is the only key: nothing here is indexed.
 */
const layers = { "art.png": "art", "text.png": "text", key: "key", "image.jpg": "image", "loop.mp4": "loop" } as const;

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string; layer: string }> }) {
  const { token, layer } = await params;
  const kind = Object.prototype.hasOwnProperty.call(layers, layer) ? layers[layer as keyof typeof layers] : null;
  const heading = kind && isLinkOnlyToken(token) ? await linkOnlyHeading(token) : null;
  if (!kind || !heading) return notFound();
  const card = curtainCardForPiece({ token, title: heading.title, author: heading.author });
  const robots = { "X-Robots-Tag": "noindex, nofollow" };
  if (kind === "key") return new Response(card.look, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", "X-Curtain-Key": card.look, ...robots } });

  if (kind === "loop") {
    const source = preparedCurtainUrl(card);
    if (!source) return notFound();
    const range = request.headers.get("Range");
    let upstream: Response;
    try {
      upstream = await fetch(source, { headers: range ? { Range: range } : undefined, signal: AbortSignal.timeout(10_000) });
    } catch {
      return new Response("Unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    if (upstream.status === 404 || upstream.status === 400) return notFound();
    if (!upstream.ok) return new Response("Unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
    const headers = new Headers({ "Content-Type": "video/mp4", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes", ...robots });
    for (const name of ["Content-Length", "Content-Range", "ETag", "Last-Modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  try {
    const bytes = kind === "image" ? await curtainPoster(card, request) : await curtainLayer(card, kind, request);
    return new Response(bytes, {
      headers: {
        "Content-Type": kind === "image" ? "image/jpeg" : "image/png",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Curtain-Key": card.look,
        ...robots,
      },
    });
  } catch (error) {
    if (error instanceof CurtainBusyError) return new Response("Busy", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "10" } });
    console.error("Prepared curtain rendering failed", error instanceof Error ? error.message : "Unknown render error");
    return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
  }
}
