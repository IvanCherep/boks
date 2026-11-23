import { loadBokForShare } from "@/lib/boks/share-preview";
import { curtainCardFor } from "@/lib/boks/curtain";
import { curtainSources } from "@/lib/boks/curtain-loop";

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

/**
 * A published bok's curtain loop, 960x504 MP4, for og:video. Made by the
 * server job (`deploy/curtain/`) and stored privately, named by the card's
 * key; served only after the publication check, so a hidden bok's loop is
 * never given out. A Series piece's loop made before publication
 * (`curtain/prepared/`) stands in until the bok has its own. Neither yet: 404,
 * and the page then offers the poster alone.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bok = await loadBokForShare(id);
  const sources = bok ? curtainSources(curtainCardFor(bok)) : [];
  const range = request.headers.get("Range");
  let upstream: Response | null = null;
  for (const source of sources) {
    try {
      upstream = await fetch(source, { headers: range ? { Range: range } : undefined, signal: AbortSignal.timeout(10_000) });
    } catch {
      return new Response("Unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    if (upstream.status !== 404 && upstream.status !== 400) break;
  }
  if (!upstream || upstream.status === 404 || upstream.status === 400) return notFound();
  if (!upstream.ok) return new Response("Unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
  const headers = new Headers({
    "Content-Type": "video/mp4",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  });
  for (const name of ["Content-Length", "Content-Range", "ETag", "Last-Modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
