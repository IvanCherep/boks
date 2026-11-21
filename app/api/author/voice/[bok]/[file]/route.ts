import { readFile } from "node:fs/promises";
import { takeContentType, takeExtension } from "@/lib/boks/series-recorder/rules";
import { voiceLimits } from "@/lib/boks/author/voice/rules";
import { addTake, removeTake, takePath, VoiceStoreError } from "@/lib/boks/author/voice/store";
import { answerTakes, voiceRoute } from "../respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ bok: string; file: string }> };

/**
 * A piece's takes. PUT to `take` adds one, with what it is in the query
 * (length, `teleprompter` or `upload`, an attached file's name, the
 * fingerprint of the text it reads); GET and DELETE name an existing take.
 */
export async function GET(request: Request, { params }: Params) {
  const { bok, file } = await params;
  return voiceRoute(request, bok, false, async (caller, bokId) => {
    const bytes = await readFile(await takePath(caller, bokId, file));
    return new Response(bytes, {
      headers: {
        "Content-Type": takeContentType[file.split(".").pop() ?? ""] ?? "application/octet-stream",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="${bokId}-${file}"`,
      },
    });
  });
}

export async function PUT(request: Request, { params }: Params) {
  const { bok, file } = await params;
  return voiceRoute(request, bok, true, async (caller, bokId, token) => {
    if (file !== "take") throw new VoiceStoreError("Upload to take.", 404);
    const declared = Number(request.headers.get("content-length"));
    if (declared > voiceLimits.takeBytes) throw new VoiceStoreError("The recording is larger than 25 MB.", 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    const query = new URL(request.url).searchParams;
    const takes = await addTake(caller, bokId, bytes, {
      extension: takeExtension(request.headers.get("content-type") ?? ""),
      durationMs: query.get("durationMs"),
      source: query.get("source"),
      name: query.get("name"),
      fingerprint: query.get("fingerprint"),
    });
    return answerTakes(token, bokId, takes, 201);
  });
}

export async function DELETE(request: Request, { params }: Params) {
  const { bok, file } = await params;
  return voiceRoute(request, bok, true, async (caller, bokId, token) =>
    answerTakes(token, bokId, await removeTake(caller, bokId, file, new URL(request.url).searchParams.get("fingerprint") ?? undefined)));
}
