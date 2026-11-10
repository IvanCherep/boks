import { loadBokForShare } from "@/lib/boks/share-preview";
import { curtainCardFor } from "@/lib/boks/curtain";
import { curtainLoopUrl } from "@/lib/boks/curtain-loop";

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

/**
 * A published bok's curtain loop, 960x504 MP4, for og:video. Made by the
 * server job (`deploy/curtain/`) and stored privately, named by the card's
 * key; served only after the publication check, so a hidden bok's loop is
 * never given out. Not made yet (a bok published minutes ago): 404, and the
 * page then offers the poster alone.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bok = await loadBokForShare(id);
  const source = bok ? curtainLoopUrl(curtainCardFor(bok)) : null;
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
