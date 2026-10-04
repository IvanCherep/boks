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
  // Александр Пушкин — Зимнее утро
  "61ba3680-210d-41ed-acae-39710a5af5c8": "/poetry/winter-morning/manifest.json",
  // Фёдор Тютчев — Весенняя гроза
  "a49896d0-be71-4b1a-9380-590738af79a2": "/poetry/spring-storm/manifest.json",
  // Александр Блок — Ночь, улица, фонарь, аптека…
  "c85132ea-8f0b-495f-a468-c3339c624fa2": "/poetry/night-street/manifest.json",
  // Emily Dickinson — Hope is the thing with feathers
  "226ea7f3-9aa8-4c2f-b654-01ee67b53fb2": "/poetry/hope-feathers/manifest.json",
  // Edgar Allan Poe — A Dream Within a Dream
  "9aa49ad9-579e-4721-881d-d84595a49975": "/poetry/dream-within-dream/manifest.json",
  // William Blake — The Tyger
  "11cbb669-6c1b-4e03-a80a-27951c9abca9": "/poetry/tyger/manifest.json",
  // Percy Bysshe Shelley — Ozymandias
  "d86fa888-50ab-493d-ae34-8ad574fc0845": "/poetry/ozymandias/manifest.json",
  // William Ernest Henley — Invictus
  "c8e05b68-5a45-4eb0-935e-d8b0ad8e6b45": "/poetry/invictus/manifest.json",
  // W. B. Yeats — The Lake Isle of Innisfree
  "9d42d01d-5a3e-4ddb-a334-3f4dfdf5dffe": "/poetry/innisfree/manifest.json",
  // Walt Whitman — O Captain! My Captain!
  "7322a7ff-0abf-4aba-b340-49477030ebed": "/poetry/o-captain/manifest.json",
  // Christina Rossetti — Remember
  "da98c07c-3386-48b4-8d1f-be02a1ff6d74": "/poetry/remember/manifest.json",
};

/** Every catalogued boks read as a poem - for the series shelf's test. */
export const poemStoryIds: readonly string[] = Object.keys(poems);

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
