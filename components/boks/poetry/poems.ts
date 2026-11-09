import type { PoemManifest } from "@/lib/boks/poetry/manifest";

/**
 * Which boks are read as immersive poems.
 *
 * The adapter the brief asks for: a renderer is chosen per piece without a
 * field on the model and without a migration. A boks listed here opens in the
 * poetry player; everything else opens in the reader it always had. Adding a
 * poem is one line here once its folder under `public/poetry/` is built - see
 * `docs/reading-formats.md`. A living author's poem points into storage
 * instead (`/l/<token>/f/manifest.json`), never into `public/`.
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
  // Александр Пушкин — Узник
  "8ca3bef0-9aa2-4d43-a21b-b9c3ed756aca": "/poetry/uznik/manifest.json",
  // Михаил Лермонтов — Утёс
  "af757f35-36d7-48b6-8db3-51c8bffaffb6": "/poetry/utyos/manifest.json",
  // Афанасий Фет — Шёпот, робкое дыханье…
  "1d2e5f7a-2501-466c-a583-0b2dade47571": "/poetry/shepot/manifest.json",
  // Николай Некрасов — Мужичок с ноготок
  "9db4cce3-9594-4a6c-a860-324a330e89f8": "/poetry/muzhichok/manifest.json",
  // Сергей Есенин — Не жалею, не зову, не плачу…
  "7082de8a-56c4-441e-82d2-2c1ecb3c2d2c": "/poetry/ne-zhaleyu/manifest.json",
  // Валерий Брюсов — Первый снег
  "7a67ce67-bceb-4e41-8f66-191718345880": "/poetry/perviy-sneg/manifest.json",
  // Gerard Manley Hopkins — Binsey Poplars
  "99ee280f-faf5-4026-99fc-9cbec9d79a2a": "/poetry/binsey-poplars/manifest.json",
  // Rupert Brooke — The Old Vicarage, Grantchester
  "afa5a1ed-3019-455e-b550-475c9a498db3": "/poetry/grantchester/manifest.json",
  // Walt Whitman — Song of the Redwood-Tree, Part 1
  "dc5150c6-fb9b-417c-8b29-40d274103acc": "/poetry/redwood-tree/manifest.json",
  // Christopher Brennan — Because She Would Ask Me Why I Loved Her
  "e07795ca-f5ee-4472-8646-f9dc64736c91": "/poetry/why-i-loved-her/manifest.json",
  // Bernard O'Dowd — Australia
  "8e2ae832-c00c-43f0-ba4b-0acd5653df03": "/poetry/australia/manifest.json",
  // Henry Wadsworth Longfellow — The Arrow and the Song
  "45035e98-5bbf-4f3f-bb1b-f88f2bc02ac2": "/poetry/arrow-and-song/manifest.json",
  // Walt Whitman — A Noiseless Patient Spider
  "011660ae-2795-4b28-bd77-0404a4a2a8ba": "/poetry/noiseless-spider/manifest.json",
  // Emily Dickinson — There is no Frigate like a Book
  "7cf8f28a-3d1a-49df-a4bb-b10a274e5347": "/poetry/no-frigate/manifest.json",
  // Lord Byron — Napoleon's Farewell
  "abbf65a4-b64b-4d8d-aa92-2f3aee583b5a": "/poetry/napoleons-farewell/manifest.json",
  // Edgar Allan Poe — Spirits of the Dead
  "0b94e076-f41d-4f81-a2d2-c1e1efe2d9e7": "/poetry/spirits-of-the-dead/manifest.json",
  // Emily Dickinson — One Need Not Be a Chamber to Be Haunted (1891 text)
  "8ec69ff8-473d-4fb9-a05d-92ae8567317a": "/poetry/one-need-not-be-a-chamber/manifest.json",
  // Thomas Hardy — The Shadow on the Stone
  "89cf5983-6c4b-466a-b0e8-79ea30a7d418": "/poetry/shadow-on-the-stone/manifest.json",
  /*
   * Алексей Прохоров, a living poet, read in his own recordings. Published
   * with his permission, but the text, the voice and the manifest are his and
   * this repository is public, so they live in storage and are served
   * same-origin through the link-only route (`docs/link-only-pieces.md`,
   * "Published author-held pieces"). Only the address is here.
   */
  // Алексей Прохоров — коса
  "cc7e3800-3567-42c1-ba08-8554a345e25c": "/l/3rUtriwuz63oiW-iyvKd1g/f/manifest.json",
  // Алексей Прохоров — из возвращения в побег
  "6c74c9da-dca3-4a16-b238-12c93242dc1f": "/l/fVw4y7K1BW8JD_hQ51AXrQ/f/manifest.json",
  // Алексей Прохоров — память шва
  "c79992b0-37ea-41f9-a2c8-cc645a3b43b7": "/l/NWYTnM2R9oqeVx59nl0x3A/f/manifest.json",
  // Алексей Прохоров — азбука веры
  "4c517503-f15f-4602-9d29-e1ac34cbbfad": "/l/lZJ7_ulrugM3vow3HYWP8g/f/manifest.json",
  // Алексей Прохоров — у горы Мегиддо
  "12794275-b2ca-48ea-a1a0-4fa1f3dd0a07": "/l/BXGiRQnLCc8ju7U0b3keGA/f/manifest.json",
  // Алексей Прохоров — розы Сарагосы
  "4eb182a0-770e-4b95-9059-07a31b229d78": "/l/uS_BvF9AbsYex07lzuXnVw/f/manifest.json",
  // Алексей Прохоров — полет сквозь сны
  "cc083c1c-ae37-4390-b607-8abd4edd2f31": "/l/jgycmR8G0ml0YoXbTeHqxA/f/manifest.json",
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Poem manifest ${url}: ${response.status}`);
    return (await response.json()) as PoemManifest;
  } finally {
    clearTimeout(timeout);
  }
}
