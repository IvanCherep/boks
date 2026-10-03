import type { PoemManifest } from "@/lib/boks/poetry/manifest";

/**
 * Which boks are read as immersive poems.
 *
 * The adapter the brief asks for: a renderer is chosen per piece without a
 * field on the model and without a migration. A boks listed here opens in the
 * poetry player; everything else opens in the reader it always had. Adding a
 * poem is one line here once its folder under `public/poetry/` is built - see
 * `docs/reading-formats.md`.
 */
const poems: Record<string, string> = {
  // Emma Lazarus — The New Colossus
  "202c3d9c-5a8e-4c91-8278-ab0fc4e602cf": "/poetry/new-colossus/manifest.json",
  // Walt Whitman — I Hear America Singing
  "3056ee24-d8c0-4963-923f-967213a3ec34": "/poetry/i-hear-america-singing/manifest.json",
};

export function poemManifestFor(storyId: string): string | null {
  return poems[storyId] ?? null;
}

/**
 * Every poem the admin sandbox can open: the catalogued ones, and
 * "Прощай, немытая Россия", which is not in the catalogue yet and has no boks.
 */
export const sandboxPoems: readonly string[] = [
  "/poetry/farewell-russia/manifest.json",
  ...Object.values(poems),
];

export async function loadPoemManifest(url: string): Promise<PoemManifest> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Poem manifest ${url}: ${response.status}`);
  return (await response.json()) as PoemManifest;
}
