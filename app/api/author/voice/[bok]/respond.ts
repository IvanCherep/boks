import { adminJsonError } from "@/lib/boks/admin-request";
import { recordChosenVoice, voiceCaller, type VoiceAccess } from "@/lib/boks/author/voice/access";
import { isBokId } from "@/lib/boks/author/voice/rules";
import { chosenTake, VoiceStoreError, type VoiceCaller } from "@/lib/boks/author/voice/store";
import type { VoiceTakes } from "@/lib/boks/author/voice/rules";

/**
 * The author's voice on a piece (`docs/author-publishing.md`): its author,
 * or Studio to listen; never cached; store errors as their own status.
 */
export async function voiceRoute(request: Request, rawBokId: string, write: boolean, handle: (caller: VoiceCaller, bokId: string, token: string, access: VoiceAccess) => Promise<Response>) {
  const bokId = rawBokId.toLowerCase();
  if (!isBokId(bokId)) return adminJsonError("Which piece is this?", 404);
  const who = await voiceCaller(request, bokId, { write });
  if (who instanceof Response) return who;
  try {
    return await handle({ userId: who.access.userId, admin: who.access.admin }, bokId, who.token, who.access);
  } catch (error) {
    if (error instanceof VoiceStoreError) return adminJsonError(error.message, error.status);
    console.error("Voice request failed.", error);
    return adminJsonError("The recording could not be saved. Try again.", 500);
  }
}

export const voiceJson = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

/** After a change: the chosen take into the database, then the takes as they stand. */
export async function answerTakes(token: string, bokId: string, takes: VoiceTakes, status = 200) {
  const refused = await recordChosenVoice(token, bokId, chosenTake(takes));
  if (refused) return refused;
  return voiceJson({ voice: takes }, status);
}
