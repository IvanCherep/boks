import { linkOnlyFilePath } from "@/lib/boks/link-only";
import type { PoemManifest } from "@/lib/boks/poetry/manifest";
import { stanzaFitProblems } from "@/lib/boks/poetry/stanza-fit";

/**
 * Studio will not attach a Series, nor send one to the feed, whose words
 * would run under the player on a phone (`lib/boks/poetry/stanza-fit.ts`).
 *
 * A living author's Series lives in link-only storage, outside the
 * repository and so outside every test; this is where the team meets it. Its
 * manifest is read from the same address the reader's player reads it from.
 * Anything that is not an immersive poem (a cinema piece) passes: its words
 * are laid out by another renderer.
 */
export async function seriesFitProblems(link: string): Promise<string[]> {
  const token = link.match(/(?:^|\/l\/)([A-Za-z0-9_-]{22,64})(?:[/?#]|$)/)?.[1];
  if (!token) return [];
  let manifest: PoemManifest;
  try {
    const response = await fetch(linkOnlyFilePath(token, "manifest.json"), { cache: "no-store" });
    if (!response.ok) return [];
    manifest = (await response.json()) as PoemManifest;
  } catch {
    // Unreadable here: the database still checks the address, and the
    // release checks the manifest again before it reaches the shelf.
    return [];
  }
  if (!Array.isArray(manifest?.scenes) || !Array.isArray(manifest?.lines)) return [];
  return stanzaFitProblems(manifest);
}
