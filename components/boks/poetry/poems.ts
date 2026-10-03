import type { PoemManifest } from "@/lib/boks/poetry/manifest";

/**
 * Which boks are read as immersive poems.
 *
 * The adapter the brief asks for: a renderer is chosen per piece without a
 * field on the model and without a migration. A boks listed here opens in the
 * poetry player; everything else opens in the reader it always had.
 *
 * "Прощай, немытая Россия" is not in the catalogue yet, so the registry is
 * empty and the format is reachable through the admin sandbox. Import the poem
 * and one line here turns it on, with no other change anywhere.
 */
const poems: Record<string, string> = {
  // "<boks id>": "/poetry/farewell-russia/manifest.json",
};

export function poemManifestFor(storyId: string): string | null {
  return poems[storyId] ?? null;
}

/** The sandbox piece, which has no boks of its own yet. */
export const sandboxPoem = "/poetry/farewell-russia/manifest.json";

export async function loadPoemManifest(url: string): Promise<PoemManifest> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Poem manifest ${url}: ${response.status}`);
  return (await response.json()) as PoemManifest;
}
