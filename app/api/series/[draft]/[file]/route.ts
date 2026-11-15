import { readFile } from "node:fs/promises";
import { seriesLimits, takeContentType, takeExtension } from "@/lib/boks/series-recorder/rules";
import { addFile, filePath, removeFile, SeriesStoreError } from "@/lib/boks/series-recorder/store";
import { seriesJson, seriesRoute } from "../../respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ draft: string; file: string }> };

/**
 * A draft's takes and pictures. PUT to `take` or `image` adds one - the name
 * is the store's to give - with what it is in the query (a take's length, a
 * picture's size); GET and DELETE name an existing file.
 */
export function GET(request: Request, { params }: Params) {
  return seriesRoute(request, async (actor) => {
    const { draft, file } = await params;
    const bytes = await readFile(await filePath(actor, draft, file));
    const extension = file.split(".").pop() ?? "";
    return new Response(bytes, {
      headers: {
        "Content-Type": extension === "jpg" ? "image/jpeg" : takeContentType[extension] ?? "application/octet-stream",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

export function PUT(request: Request, { params }: Params) {
  return seriesRoute(request, async (actor) => {
    const { draft, file: kind } = await params;
    if (kind !== "take" && kind !== "image") throw new SeriesStoreError("Upload to take or image.", 404);
    const limit = kind === "take" ? seriesLimits.takeBytes : seriesLimits.imageBytes;
    const declared = Number(request.headers.get("content-length"));
    if (declared > limit) throw new SeriesStoreError("The file is too large.", 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.byteLength) throw new SeriesStoreError("The file is empty.", 400);
    const query = new URL(request.url).searchParams;
    const extension = kind === "take" ? takeExtension(request.headers.get("content-type") ?? "") : "jpg";
    if (!extension) throw new SeriesStoreError("This kind of recording is not accepted.", 415);
    const updated = await addFile(actor, draft, kind, bytes, {
      extension,
      durationMs: Number(query.get("durationMs")),
      width: Number(query.get("width")),
      height: Number(query.get("height")),
    });
    return seriesJson({ draft: updated }, 201);
  });
}

export function DELETE(request: Request, { params }: Params) {
  return seriesRoute(request, async (actor) => {
    const { draft, file } = await params;
    return seriesJson({ draft: await removeFile(actor, draft, file) });
  });
}
