import { loadAuthorPhoto } from "@/lib/boks/author-preview";

/**
 * The photo an author set for their page (`author_spaces.photo`), as a JPEG.
 *
 * Its address carries the photo's version (`?v=`), and a new photo is a new
 * version, so a versioned address can be cached for good. Without a photo,
 * 404: the page shows a monogram instead.
 */
type RouteParams = { handle: string };

export async function GET(request: Request, { params }: { params: RouteParams | Promise<RouteParams> }) {
  const { handle } = await params;
  const photo = await loadAuthorPhoto(String(handle ?? ""));
  if (!photo) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
  const asked = new URL(request.url).searchParams.get("v");
  const current = asked === String(photo.version);
  return new Response(photo.jpeg, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(photo.jpeg.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": current ? "public, max-age=31536000, immutable" : "public, max-age=60",
    },
  });
}
