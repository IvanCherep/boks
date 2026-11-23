import type { CurtainCard } from "./curtain";

type Stored = Pick<CurtainCard, "id" | "key"> & Partial<Pick<CurtainCard, "look" | "piece">>;

function storeBase() {
  const base = globalThis.process?.env?.BOKS_LINK_ONLY_BASE_URL;
  return base ? base.replace(/\/+$/, "") : null;
}

/**
 * Where a bok's curtain loop is stored: `curtain/<id>-<key>.mp4` in the
 * private file store the app already reads link-only pieces from
 * (`BOKS_LINK_ONLY_BASE_URL`, internal only). The job (`deploy/curtain/`)
 * writes the same name. Null where there is no such store.
 */
export function curtainLoopUrl(card: Pick<CurtainCard, "id" | "key">, kind: "mp4" | "jpg" = "mp4") {
  const base = storeBase();
  if (!base || !/^[0-9a-f-]{36}$/.test(card.id) || !/^[0-9a-f]{8}$/.test(card.key)) return null;
  return `${base}/curtain/${card.id}-${card.key}.${kind}`;
}

/**
 * The loop and poster made before publication for a Series piece
 * (`curtain/prepared/<piece>-<look>.mp4|jpg`, `docs/link-only-pieces.md`).
 * A published bok whose card still looks the same uses them until, and
 * instead of, its own.
 */
export function preparedCurtainUrl(card: Partial<Pick<CurtainCard, "look" | "piece">>, kind: "mp4" | "jpg" = "mp4") {
  const base = storeBase();
  if (!base || !card.piece || !card.look || !/^[A-Za-z0-9_-]{22,64}$/.test(card.piece) || !/^[0-9a-f]{8}$/.test(card.look)) return null;
  return `${base}/curtain/prepared/${card.piece}-${card.look}.${kind}`;
}

/** Where to look, in order: the bok's own file, then the one prepared ahead. */
export function curtainSources(card: Stored, kind: "mp4" | "jpg" = "mp4") {
  return [curtainLoopUrl(card, kind), preparedCurtainUrl(card, kind)].filter((url): url is string => url !== null);
}

/**
 * The 1200x630 poster the job stored beside the loop (`<id>-<key>.jpg`, or
 * the prepared one), so a copy does not draw it (about two seconds of a busy
 * process) after every release. Null when it is not there yet; then the app
 * draws it.
 */
export async function storedCurtainPoster(card: Stored, timeoutMs = 1500): Promise<Uint8Array<ArrayBuffer> | null> {
  for (const url of curtainSources(card, "jpg")) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      // A JPEG, whole: starts FFD8, ends FFD9.
      if (bytes.length > 1000 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return bytes;
    } catch {
      // the next source, or none
    }
  }
  return null;
}

/** The first stored loop for the card: a quick internal HEAD each, never a reason to hold a page. */
export async function curtainLoopSource(card: Stored, timeoutMs = 400) {
  for (const url of curtainSources(card)) {
    try {
      if ((await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) })).ok) return url;
    } catch {
      // the next source, or none
    }
  }
  return null;
}

/** Whether a loop is there yet. */
export async function curtainLoopReady(card: Stored, timeoutMs = 400) {
  return (await curtainLoopSource(card, timeoutMs)) !== null;
}
