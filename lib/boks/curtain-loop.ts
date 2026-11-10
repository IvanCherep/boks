import type { CurtainCard } from "./curtain";

/**
 * Where a bok's curtain loop is stored: `curtain/<id>-<key>.mp4` in the
 * private file store the app already reads link-only pieces from
 * (`BOKS_LINK_ONLY_BASE_URL`, internal only). The job (`deploy/curtain/`)
 * writes the same name. Null where there is no such store.
 */
export function curtainLoopUrl(card: Pick<CurtainCard, "id" | "key">) {
  const base = globalThis.process?.env?.BOKS_LINK_ONLY_BASE_URL;
  if (!base || !/^[0-9a-f-]{36}$/.test(card.id) || !/^[0-9a-f]{8}$/.test(card.key)) return null;
  return `${base.replace(/\/+$/, "")}/curtain/${card.id}-${card.key}.mp4`;
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
