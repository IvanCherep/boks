import { loadAuthorPhoto, loadMovedAuthorHandle } from "@/lib/boks/author-preview";
import { photoSizeOf } from "@/lib/boks/author/photo-path";
import { sizedAuthorPhoto } from "@/lib/boks/author/photo-sizes";

/**
 * The photo an author set for their page (`author_spaces.photo`), as a JPEG.
 *
 * Its address carries the photo's version (`?v=`), and a new photo is a new
 * version, so a versioned address can be cached for good. Without a photo,
 * 404: the page shows a monogram instead. `&s=s|l` asks for the size a screen
 * shows (`lib/boks/author/photo-sizes.ts`); without it, the stored original.
 */
type RouteParams = { handle: string };

export async function GET(request: Request, { params }: { params: RouteParams | Promise<RouteParams> }) {
  const { handle } = await params;
  const photo = await loadAuthorPhoto(String(handle ?? ""));
  if (!photo) {
    // An author who changed their @handle: previews already shared still ask for the old address.
    const moved = await loadMovedAuthorHandle(String(handle ?? ""));
    if (moved) {
      const target = new URL(`/a/${moved}/photo`, request.url);
      target.search = new URL(request.url).search;
      return new Response(null, { status: 301, headers: { Location: target.pathname + target.search, "Cache-Control": "public, max-age=3600" } });
    }
  }
  if (!photo) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
  const query = new URL(request.url).searchParams;
  const current = query.get("v") === String(photo.version);
  const size = photoSizeOf(query.get("s"));
  let body = photo.jpeg;
  if (size) {
    try {
      body = sizedAuthorPhoto(`${String(handle).toLowerCase()}\u0000${photo.version}`, photo.jpeg, size);
    } catch {
      // A photo jpeg-js cannot read still shows, at its stored size.
    }
  }
  return new Response(body, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(body.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": current ? "public, max-age=31536000, immutable" : "public, max-age=60",
    },
  });
}
