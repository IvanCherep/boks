import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isTakeFile, looksLikeAudio } from "@/lib/boks/series-recorder/rules";
import { seriesRoot } from "@/lib/boks/series-recorder/store";
import {
  chosenAfterAdding,
  chosenAfterRemoving,
  isBokId,
  isFingerprint,
  isVoiceSource,
  voiceLimits,
  type VoiceSource,
  type VoiceTake,
  type VoiceTakes,
} from "@/lib/boks/author/voice/rules";

/**
 * A piece's takes on disk, beside the Series recorder's drafts:
 * `<seriesRoot>/voices/<bokId>/` holds `voice.json` and the takes
 * (`take-<n>.<ext>`). The folder is the author's who first put a take in it;
 * the database keeps only the chosen take (`set_my_bok_voice`), which the
 * route sets after every change here.
 */

export class VoiceStoreError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export const voicesRoot = () => join(seriesRoot(), "voices");

const folder = (bokId: string) => {
  if (!isBokId(bokId)) throw new VoiceStoreError("Which piece is this?", 404);
  return join(voicesRoot(), bokId);
};

const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

async function writeJson(path: string, value: unknown) {
  const temporary = `${path}.${randomHex(4)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 1)}\n`);
  await rename(temporary, path);
}

async function readStored(bokId: string): Promise<VoiceTakes | null> {
  const path = join(folder(bokId), "voice.json");
  try {
    return JSON.parse(await readFile(path, "utf8")) as VoiceTakes;
  } catch {
    return null;
  }
}

/**
 * Who may touch a piece's takes: its author writes them; Studio only listens.
 * `owns`: the database says the piece is the caller's (`reels.author_user_id`),
 * which also covers a text the team prepared with a recording before the
 * author had it (its folder was started in the page's name).
 */
export type VoiceCaller = { userId: string; admin: boolean; owns?: boolean };

function owned(stored: VoiceTakes | null, caller: VoiceCaller, write: boolean) {
  if (!stored) return null;
  if (stored.ownerId === caller.userId || caller.owns) return stored;
  if (!write && caller.admin) return stored;
  throw new VoiceStoreError("This piece belongs to another account.", 403);
}

/** The piece's takes; none yet is an empty list for its author. */
export async function readTakes(caller: VoiceCaller, bokId: string): Promise<VoiceTakes> {
  return owned(await readStored(bokId), caller, false) ?? { ownerId: caller.userId, takes: [], chosen: null, uploads: 0 };
}

export const chosenTake = (takes: VoiceTakes) => takes.takes.find((take) => take.file === takes.chosen) ?? null;

const nextNumber = (files: string[]) => files.reduce((top, file) => Math.max(top, Number(file.slice(5).split(".")[0]) || 0), 0) + 1;

/** A new take, recorded with the teleprompter or attached. Its name is chosen here. */
export async function addTake(
  caller: VoiceCaller,
  bokId: string,
  bytes: Uint8Array,
  meta: { extension: string | null; durationMs: unknown; source: unknown; name?: unknown; fingerprint: unknown },
): Promise<VoiceTakes> {
  const stored = owned(await readStored(bokId), caller, true) ?? { ownerId: caller.userId, takes: [], chosen: null, uploads: 0 };
  if (stored.takes.length >= voiceLimits.takes) throw new VoiceStoreError(`At most ${voiceLimits.takes} takes. Delete one first.`, 409);
  if (stored.uploads >= voiceLimits.takeUploads) throw new VoiceStoreError(`At most ${voiceLimits.takeUploads} takes for one piece. Choose among the ones you have.`, 409);
  if (!bytes.byteLength) throw new VoiceStoreError("The file is empty.", 400);
  if (bytes.byteLength > voiceLimits.takeBytes) throw new VoiceStoreError("The recording is larger than 25 MB.", 413);
  const durationMs = Math.round(Number(meta.durationMs));
  if (!Number.isFinite(durationMs) || durationMs < voiceLimits.minTakeMs) throw new VoiceStoreError("The recording is too short.", 400);
  if (durationMs > voiceLimits.takeMs) throw new VoiceStoreError("The recording is longer than 15 minutes.", 400);
  if (!isVoiceSource(meta.source)) throw new VoiceStoreError("Recorded or attached?", 400);
  if (!isFingerprint(meta.fingerprint)) throw new VoiceStoreError("Which text does the recording read?", 400);
  const file = `take-${nextNumber(stored.takes.map((take) => take.file))}.${meta.extension}`;
  if (!meta.extension || !isTakeFile(file)) throw new VoiceStoreError("This kind of recording is not accepted: mp3, m4a, wav, ogg or webm.", 415);
  if (!looksLikeAudio(bytes, meta.extension)) throw new VoiceStoreError("This file is not a recording we can read.", 415);
  const name = typeof meta.name === "string" && meta.name.trim() ? meta.name.trim().slice(0, voiceLimits.nameChars) : null;
  await mkdir(folder(bokId), { recursive: true });
  await writeFile(join(folder(bokId), file), bytes);
  const take: VoiceTake = { file, durationMs, bytes: bytes.byteLength, source: meta.source as VoiceSource, name, fingerprint: meta.fingerprint, createdAt: new Date().toISOString() };
  const next: VoiceTakes = { ...stored, takes: [...stored.takes, take], chosen: chosenAfterAdding(stored, take), uploads: stored.uploads + 1 };
  await writeJson(join(folder(bokId), "voice.json"), next);
  return next;
}

export async function chooseTake(caller: VoiceCaller, bokId: string, file: unknown): Promise<VoiceTakes> {
  const stored = owned(await readStored(bokId), caller, true);
  if (!stored || typeof file !== "string" || !stored.takes.some((take) => take.file === file)) throw new VoiceStoreError("No such take.", 404);
  const next = { ...stored, chosen: file };
  await writeJson(join(folder(bokId), "voice.json"), next);
  return next;
}

export async function removeTake(caller: VoiceCaller, bokId: string, file: string, fingerprint?: string): Promise<VoiceTakes> {
  const stored = owned(await readStored(bokId), caller, true);
  if (!stored || !stored.takes.some((take) => take.file === file)) throw new VoiceStoreError("No such take.", 404);
  const next = { ...stored, takes: stored.takes.filter((take) => take.file !== file), chosen: chosenAfterRemoving(stored.takes, stored.chosen, file, isFingerprint(fingerprint) ? fingerprint : undefined) };
  await writeJson(join(folder(bokId), "voice.json"), next);
  await rm(join(folder(bokId), file), { force: true });
  return next;
}

/** A take's path on disk, for its author or Studio to listen to. */
export async function takePath(caller: VoiceCaller, bokId: string, file: string) {
  const stored = owned(await readStored(bokId), caller, false);
  if (!isTakeFile(file) || !stored?.takes.some((take) => take.file === file)) throw new VoiceStoreError("No such take.", 404);
  return join(folder(bokId), file);
}
