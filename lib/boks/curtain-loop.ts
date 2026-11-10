import type { CurtainCard } from "./curtain";

/**
 * Where a bok's curtain loop is stored: `curtain/<id>-<key>.mp4` in the
 * private file store the app already reads link-only pieces from
 * (`BOKS_LINK_ONLY_BASE_URL`, internal only). The job (`deploy/curtain/`)
 * writes the same name. Null where there is no such store.
 */
export function curtainLoopUrl(card: Pick<CurtainCard, "id" | "key">, kind: "mp4" | "jpg" = "mp4") {
  const base = globalThis.process?.env?.BOKS_LINK_ONLY_BASE_URL;
  if (!base || !/^[0-9a-f-]{36}$/.test(card.id) || !/^[0-9a-f]{8}$/.test(card.key)) return null;
  return `${base.replace(/\/+$/, "")}/curtain/${card.id}-${card.key}.${kind}`;
}

/**
 * The 1200x630 poster the job stored beside the loop (`<id>-<key>.jpg`), so
 * a copy does not draw it (about two seconds of a busy process) after every
 * release. Null when it is not there yet; then the app draws it.
 */
export async function storedCurtainPoster(card: Pick<CurtainCard, "id" | "key">, timeoutMs = 1500): Promise<Uint8Array<ArrayBuffer> | null> {
  const url = curtainLoopUrl(card, "jpg");
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A JPEG, whole: starts FFD8, ends FFD9.
    const whole = bytes.length > 1000 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
    return whole ? bytes : null;
  } catch {
    return null;
  }
}

/** Whether the loop is there yet: a quick internal HEAD, never a reason to hold a page. */
export async function curtainLoopReady(card: Pick<CurtainCard, "id" | "key">, timeoutMs = 400) {
  const url = curtainLoopUrl(card);
  if (!url) return false;
  try {
    return (await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) })).ok;
  } catch {
    return false;
  }
}
