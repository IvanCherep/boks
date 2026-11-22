import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { voicesRoot } from "@/lib/boks/author/voice/store";
import { isBokId } from "@/lib/boks/author/voice/rules";
import { isTakeFile, type SeriesActor } from "@/lib/boks/series-recorder/rules";
import { addFile, createDraft, readDraft, SeriesStoreError } from "@/lib/boks/series-recorder/store";

/**
 * A Studio recorder draft for a piece the editors took into work
 * (`docs/author-publishing.md`, "The editors make the Boks Series"): its
 * title, text and byline, and the author's chosen take copied in from
 * `<seriesRoot>/voices/<bok>/` as the draft's first take, so nobody uploads
 * it again. A draft already made for the piece is opened instead.
 */
export type SeriesSource = {
  bokId: string;
  title: string;
  text: string;
  byline: string;
  draftId: string | null;
  voice: { file: string; durationMs: number } | null;
};

export async function draftFromBok(actor: SeriesActor, source: SeriesSource) {
  if (!actor.admin) throw new SeriesStoreError("Only the boks editors make a Series from an author's piece.", 403);
  if (!isBokId(source.bokId)) throw new SeriesStoreError("Which piece is this?", 404);
  if (source.draftId) {
    const existing = await readDraft(actor, source.draftId).catch(() => null);
    if (existing) return { draft: existing, created: false };
  }
  if (!source.voice || !isTakeFile(source.voice.file)) throw new SeriesStoreError("The piece has no reading by its author.", 409);
  const bytes = new Uint8Array(await readFile(join(voicesRoot(), source.bokId, source.voice.file)).catch(() => {
    throw new SeriesStoreError("The author's recording is not on this server.", 409);
  }));
  const draft = await createDraft(actor, { title: source.title, author: source.byline, text: source.text });
  const extension = source.voice.file.split(".").pop() ?? "";
  return { draft: await addFile(actor, draft.id, "take", bytes, { extension, durationMs: source.voice.durationMs }), created: true };
}
