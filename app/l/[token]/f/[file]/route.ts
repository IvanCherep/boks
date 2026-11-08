import { linkOnlyContentType, linkOnlyStorageUrl } from "@/lib/boks/link-only";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}

/**
 * One file of a link-only piece, served from this origin.
 *
 * Same-origin on purpose: the scene gestures draw the picture into WebGL, which
 * refuses a cross-origin image without CORS, and the page's policy then needs
 * no storage host in `img-src` or `media-src`. Only a valid token and one of a
 * piece's own file names reach storage (`lib/boks/link-only.ts`).
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string; file: string }> }) {
  const { token, file } = await params;
  const source = supabaseUrl ? linkOnlyStorageUrl(supabaseUrl, token, file) : null;
  if (!source) return notFound();

  const range = request.headers.get("Range");
  let upstream: Response;
  try {
    upstream = await fetch(source, {
      headers: range ? { Range: range } : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return new Response("Unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  if (upstream.status === 400 || upstream.status === 404) return notFound();
  if (!upstream.ok) return new Response("Unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });

  const headers = new Headers({
    "Content-Type": linkOnlyContentType(file),
    "Cache-Control": "public, max-age=600",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  });
  // A link preview card is meant to be fetched by every messenger; nothing
  // else in a folder is.
  if (!file.endsWith("-share.jpg")) headers.set("X-Robots-Tag", "noindex, nofollow");
  for (const name of ["Content-Length", "Content-Range", "ETag", "Last-Modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
