import { chooseTake, readTakes, VoiceStoreError } from "@/lib/boks/author/voice/store";
import { answerTakes, voiceJson, voiceRoute } from "./respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ bok: string }> };

/** A piece's takes (its author, or Studio); PATCH `{ chosen }` chooses the one that goes to the editors. */
export async function GET(request: Request, { params }: Params) {
  return voiceRoute(request, (await params).bok, false, async (caller, bokId) => voiceJson({ voice: await readTakes(caller, bokId) }));
}

export async function PATCH(request: Request, { params }: Params) {
  return voiceRoute(request, (await params).bok, true, async (caller, bokId, token) => {
    const raw = await request.text();
    if (raw.length > 4096) throw new VoiceStoreError("The request is too large.", 413);
    let body: { chosen?: unknown };
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      throw new VoiceStoreError("The request body must be a JSON object.", 400);
    }
    return answerTakes(token, bokId, await chooseTake(caller, bokId, body.chosen));
  });
}
