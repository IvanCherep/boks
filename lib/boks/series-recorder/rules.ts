/**
 * The Series recorder (beta, Studio only): an author's text, read aloud
 * through a teleprompter, a few takes, the author's own pictures, and from the
 * chosen take an immersive poem built the way the hand-made ones are - the
 * voice brought to the series' loudness, the words timed by forced alignment,
 * the stanzas fitted above the player (`docs/series-recorder.md`).
 *
 * This file is the shape of a draft and its limits, shared by the Studio page,
 * the API route that keeps drafts on disk and the worker that builds them.
 */

export const seriesLimits = {
  takes: 5,
  images: 5,
  /** Pictures one generation may make; a draft still holds at most `images`. */
  generate: 4,
  /**
   * Pictures a Series may have drawn in all, generations and redraws
   * together, whatever is later deleted. A draft may carry its own
   * (`artAllowance`), so an author can one day be given more.
   */
  artBudget: 8,
  /** Series built from a draft that stay to choose between: the first and one rebuild. */
  builds: 2,
  /**
   * Builds an author may start for one draft, failed ones included (a failure
   * of the voice service itself is not counted): each costs a pass through
   * ElevenLabs. Studio has no such ceiling.
   */
  buildAttempts: 6,
  /** Takes an author may upload or record for one draft in all, deleted ones included. */
  takeUploads: 20,
  /** Times a generated picture may be drawn again; the earlier version is kept to switch back to. */
  regenerations: 1,
  /** Characters of the poem, title not included. */
  textChars: 6000,
  lines: 120,
  titleChars: 120,
  authorChars: 120,
  /** A take: about ten minutes of opus or AAC at 128 kbit/s, with room. */
  takeBytes: 25 * 1024 * 1024,
  /** A picture after the browser has made it at most 2160 px on its long side. */
  imageBytes: 12 * 1024 * 1024,
  takeMs: 10 * 60 * 1000,
} as const;

/** Below this share of the text heard in the take, the build stops and says what was missed. */
export const minimumMatch = 0.85;

export type SeriesTake = {
  /** `take-<n>.<ext>`, the file in the draft's folder. */
  file: string;
  durationMs: number;
  bytes: number;
  createdAt: string;
};

export type SeriesImageVersion = {
  /** `image-<n>.jpg`. */
  file: string;
  width: number;
  height: number;
};

/**
 * A picture of the Series, in its place. `file` is the version shown and
 * built; a generated picture drawn again keeps both versions to switch
 * between. Pictures are never reordered: a picture is replaced by deleting
 * it and adding another.
 */
export type SeriesImage = SeriesImageVersion & {
  source: "upload" | "generated";
  /** What the picture was drawn from (generated only). */
  prompt?: string;
  versions?: SeriesImageVersion[];
};

/** Making pictures: a generation of several, or one picture drawn again. */
export type SeriesArtJob =
  | { jobId: string; kind: "generate"; count: number; prompts: string[] | null }
  | { jobId: string; kind: "regenerate"; file: string; prompt: string };

export type SeriesArtStatus =
  | { state: "idle"; error?: SeriesArtErrorCode }
  | { state: "queued" | "drawing"; kind: "generate"; count: number }
  | { state: "queued" | "drawing"; kind: "regenerate"; file: string };

/** `unavailable`: the picture service is out of quota or not answering; pictures can still be uploaded. */
export type SeriesArtErrorCode = "unavailable" | "refused" | "unexpected";

/** Pictures drawn and still allowed for a draft; `used` counts pictures being drawn right now. */
export type SeriesArtBudget = { used: number; limit: number; left: number };

export const isGeneratedImage = (image: SeriesImage) => image.source === "generated";
export const canRegenerate = (image: SeriesImage) => isGeneratedImage(image) && (image.versions?.length ?? 1) <= seriesLimits.regenerations;

export type SeriesDraftData = {
  id: string;
  title: string;
  author: string;
  text: string;
  takes: SeriesTake[];
  images: SeriesImage[];
  /** The take that becomes the Series. */
  chosenTake: string | null;
  /** The link-only folder the Series is built into; kept across rebuilds so its link stays. */
  token: string | null;
  /** The Series built so far, at most `seriesLimits.builds`; each has its own link-only folder. */
  builds?: SeriesBuild[];
  /** Which of `builds` stays: its token is `token`, the link that is shared. */
  keptBuild?: number;
  /** Who made it: an author's drafts are theirs alone; Studio sees every one. */
  ownerId?: string | null;
  ownerHandle?: string | null;
  /** On the author's page: the bok it was published as, which build's recording it plays, and (published by Studio) whose page. */
  published?: { bokId: string; token: string; at: string; handle?: string } | null;
  /** Builds started (author drafts are capped, `seriesLimits.buildAttempts`). */
  buildAttempts?: number;
  /** Takes added in all, deleted ones included (`seriesLimits.takeUploads`). */
  takeUploads?: number;
  /** Pictures drawn for this draft so far, redraws included; deleting one gives nothing back. */
  artUsed?: number;
  /** This draft's own allowance of drawn pictures, when it is not `seriesLimits.artBudget`. */
  artAllowance?: number;
  createdAt: string;
  updatedAt: string;
};

export type SeriesBuildStep = "audio" | "listening" | "pictures" | "assembling";

export type SeriesBuildResult = {
  jobId: string;
  ok: boolean;
  finishedAt: string;
  token?: string;
  durationMs?: number;
  /** Share of the text's words heard in the take, 0..1. */
  match?: number;
  words?: number;
  /** Words of the text not heard, and words heard that are not in the text: the first few of each. */
  missed?: string[];
  extra?: string[];
  scenes?: number;
  /** Why a build failed, for the page to say in its own words; `error` is the worker's detail. */
  errorCode?: SeriesBuildErrorCode;
  error?: string;
};

/**
 * `quota`: the voice service has run out of what we pay for; `service`: it
 * did not answer. Neither is the author's to fix, and the page says so.
 */
export type SeriesBuildErrorCode = "mismatch" | "silent" | "long" | "layout" | "quota" | "service" | "unexpected";

/** Who is asking: the account, and whether it is Studio. */
export type SeriesActor = {
  userId: string;
  admin: boolean;
  handle?: string | null;
  /** What an author's Series are signed with (their page, else their byline); Studio types its own. */
  authorName?: string | null;
  /** The caller's own name (their page, else their only byline), the default byline of a new draft; null when they have none. */
  ownName?: string | null;
};

export type SeriesBuild = { token: string; result: SeriesBuildResult; sourceHash: string };

export type SeriesDraftStatus =
  | { state: "draft" }
  | { state: "queued"; jobId: string }
  | { state: "processing"; jobId: string; step: SeriesBuildStep | null }
  /**
   * Built at least once: the builds, which one stays, whether the draft has
   * changed since the kept one, and the last attempt if it failed after them.
   */
  | { state: "ready"; result: SeriesBuildResult; builds: SeriesBuild[]; kept: number; stale: boolean; failure?: SeriesBuildResult }
  | { state: "failed"; result: SeriesBuildResult };

export type SeriesDraft = SeriesDraftData & { status: SeriesDraftStatus; art: SeriesArtStatus; artBudget: SeriesArtBudget };

export type SeriesDraftSummary = Pick<SeriesDraftData, "id" | "title" | "author" | "updatedAt" | "token" | "ownerHandle"> & {
  takes: number;
  images: number;
  status: SeriesDraftStatus["state"];
};

const draftIdPattern = /^[0-9a-f]{16}$/;
const takePattern = /^take-([1-9][0-9]{0,2})\.(webm|mp4|ogg|m4a|wav|mp3)$/;
const imagePattern = /^image-([1-9][0-9]{0,2})\.jpg$/;

export const isSeriesDraftId = (value: string) => draftIdPattern.test(value);
export const isTakeFile = (value: string) => takePattern.test(value);
export const isImageFile = (value: string) => imagePattern.test(value);

/** The extension a recording keeps, from what the browser's recorder said it made. */
export function takeExtension(mimeType: string): string | null {
  const type = mimeType.split(";")[0].trim().toLowerCase();
  if (type === "audio/webm" || type === "video/webm") return "webm";
  if (type === "audio/mp4" || type === "video/mp4" || type === "audio/x-m4a" || type === "audio/aac") return "mp4";
  if (type === "audio/ogg") return "ogg";
  if (type === "audio/wav" || type === "audio/x-wav" || type === "audio/wave") return "wav";
  if (type === "audio/mpeg" || type === "audio/mp3") return "mp3";
  return null;
}

export const takeContentType: Record<string, string> = {
  webm: "audio/webm",
  mp4: "audio/mp4",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp3: "audio/mpeg",
};

/**
 * Whether the bytes are the kind of recording the extension says: a take is
 * stored and later handed to ffmpeg, so a file that is not audio is refused
 * at the door rather than kept.
 */
export function looksLikeAudio(bytes: Uint8Array, extension: string) {
  const at = (offset: number, text: string) => [...text].every((ch, i) => bytes[offset + i] === ch.charCodeAt(0));
  if (bytes.length < 16) return false;
  switch (extension) {
    case "webm": return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    case "mp4":
    case "m4a": return at(4, "ftyp");
    case "ogg": return at(0, "OggS");
    case "wav": return at(0, "RIFF") && at(8, "WAVE");
    case "mp3": return at(0, "ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    default: return false;
  }
}

/**
 * The poem as the recorder reads it: lines in order, and how many lines each
 * stanza holds (a blank line ends a stanza). Spaces are tidied, nothing else:
 * the words and their punctuation are the author's.
 */
export function poemLines(text: string): { lines: string[]; stanzas: number[] } {
  const lines: string[] = [];
  const stanzas: number[] = [];
  let current = 0;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/[   \t ]+/g, " ").trim();
    if (!line) {
      if (current) stanzas.push(current);
      current = 0;
      continue;
    }
    lines.push(line);
    current += 1;
  }
  if (current) stanzas.push(current);
  return { lines, stanzas };
}

/** Words of a line as the manifest counts them: cut on spaces, a dash on its own is not a word. */
export function lineWords(line: string) {
  return line.split(/\s+/).filter((word) => word && !/^[-–—]+$/.test(word));
}

/** About how long the poem takes to read aloud, for the teleprompter's first pace: 2.1 words a second and a breath a line. */
export function estimatedReadingMs(lines: string[]) {
  const words = lines.reduce((sum, line) => sum + lineWords(line).length, 0);
  return Math.round((words / 2.1) * 1000 + lines.length * 350);
}

/** What is still missing before a draft can be built, in order. Empty when it can. */
export function draftGaps(draft: Pick<SeriesDraftData, "title" | "text" | "takes" | "images" | "chosenTake">): ("title" | "text" | "take" | "images")[] {
  const gaps: ("title" | "text" | "take" | "images")[] = [];
  if (!draft.title.trim()) gaps.push("title");
  if (!poemLines(draft.text).lines.length) gaps.push("text");
  if (!draft.chosenTake || !draft.takes.some((take) => take.file === draft.chosenTake)) gaps.push("take");
  if (!draft.images.length) gaps.push("images");
  return gaps;
}
