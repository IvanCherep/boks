import { adminJsonError, bearerToken } from "@/lib/boks/admin-request";
import { takeExtension } from "@/lib/boks/series-recorder/rules";
import { isBokId, voiceFingerprint, voiceLimits } from "@/lib/boks/author/voice/rules";
import { addTake, chooseTake, chosenTake, VoiceStoreError } from "@/lib/boks/author/voice/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ seed: string }> };

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseApiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const restBase = () => globalThis.process?.env?.BOKS_INTERNAL_REST_URL || `${supabaseUrl}/rest/v1`;

async function rpc(token: string, name: string, body: unknown) {
  const response = await fetch(`${restBase()}/rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: supabaseApiKey!, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new VoiceStoreError(String(json.message || "The database refused."), response.status === 401 || response.status === 403 ? 403 : 409);
  return json;
}

/**
 * Studio attaches the author's own recording to a text the team prepared
 * for the cabinet (`docs/author-agreements.md`, "The way in"). The take goes
 * where the author's takes live (`voices/<id>/`, the id the draft takes),
 * checked against the text as it is now, and the database keeps it on the
 * text, or as the author's chosen recording once they have the draft.
 */
export async function PUT(request: Request, { params }: Params) {
  const seedId = (await params).seed.toLowerCase();
  if (!isBokId(seedId)) return adminJsonError("Which text is this?", 404);
  if (!supabaseUrl || !supabaseApiKey) return adminJsonError("Supabase is not configured for this deployment.", 503);
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return adminJsonError("Sign in required.", 401);
  try {
    // Editors only: the call refuses anyone else.
    const seed = await rpc(token, "studio_space_seed", { p_seed_id: seedId });
    const declared = Number(request.headers.get("content-length"));
    if (declared > voiceLimits.takeBytes) throw new VoiceStoreError("The recording is larger than 25 MB.", 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    const query = new URL(request.url).searchParams;
    const owner = typeof seed.ownerId === "string" ? seed.ownerId : `space-${String(seed.spaceId)}`;
    const caller = { userId: owner, admin: true, owns: true };
    const added = await addTake(caller, seedId, bytes, {
      extension: takeExtension(request.headers.get("content-type") ?? ""),
      durationMs: query.get("durationMs"),
      source: "upload",
      name: query.get("name"),
      fingerprint: await voiceFingerprint(String(seed.text ?? "")),
    });
    // The team's newest file is the one that goes on, even when an older take reads the same text.
    const take = chosenTake(await chooseTake(caller, seedId, added.takes[added.takes.length - 1]?.file));
    if (!take) throw new VoiceStoreError("The recording could not be saved. Try again.", 500);
    const saved = await rpc(token, "studio_set_space_seed_voice", {
      p_seed_id: seedId,
      p_voice: { file: take.file, durationMs: take.durationMs, source: "upload", name: take.name, fingerprint: take.fingerprint, recordedAt: take.createdAt },
    });
    return Response.json({ seed: saved }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof VoiceStoreError) return adminJsonError(error.message, error.status);
    console.error("Studio voice upload failed.", error);
    return adminJsonError("The recording could not be saved. Try again.", 500);
  }
}
