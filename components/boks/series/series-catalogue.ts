import { poemManifestFor } from "@/components/boks/poetry/poems";
import { isBoksSeriesPiece } from "@/components/boks/cinema/series";
import { plural } from "@/lib/i18n/messages";
import type { UiLanguage } from "@/lib/i18n/ui-language";

/**
 * boks series: the pieces made in the new format, gathered in one place.
 *
 * A series piece still lives in the ordinary feed - it is a boks like any
 * other, and the feed may offer it to anyone. Only part of the catalogue will
 * ever be produced this way, so the series tab is where a reader who wants
 * *these* finds them, rather than waiting for the ranker to deal one.
 *
 * What a piece is opened in is not decided here. That is still the two format
 * registries - `poemManifestFor` for verse, `isBoksSeriesPiece` for the cinema
 * - and `series-catalogue.test.ts` holds this list and those two to the same
 * set of boks in both directions, so a finished piece cannot be left off the
 * shelf and a shelf entry cannot point at a piece that opens as plain text.
 *
 * What lives here is only what the shelf needs to draw a card before the
 * network answers: a cover, how long it plays, what it is made of. The title
 * and the author are repeated for the same reason, and are replaced by the
 * catalogue's own as soon as it answers - which also drops a piece an admin
 * has hidden, so the database stays the authority on what is published.
 */

export type SeriesFormat = "cinema" | "poem";

/**
 * The language a piece is read in: any tag, `"it"` and `"sr"` included. The
 * shelf's filter offers whatever languages the pieces on it carry, so a new
 * language needs no change outside its pieces (`lib/i18n/content-languages.ts`
 * names it).
 */
export type SeriesLanguage = string;

export type SeriesPiece = {
  /** The boks id - the same id the feed, likes and comments use. */
  storyId: string;
  format: SeriesFormat;
  language: SeriesLanguage;
  title: string;
  author: string;
  /** A downsized frame of the piece's own art, `public/series/<name>.webp`. */
  cover: string;
  /** Where the subject of the cover sits, as CSS `object-position`. */
  coverFocus: string;
  /** Dark wordmark for a bright upper image; otherwise the cover uses light ink. */
  /** Length of the recording, from its alignment or manifest. Tested. */
  durationSeconds: number;
  /** Pictures the piece moves through. Tested against the format's registry. */
  scenes: number;
  /** Places where the story stops and asks the reader to do something. */
  moments: number;
  /** The day it opened to readers, `YYYY-MM-DD`. Newest leads the shelf. */
  premieredOn: string;
};

/**
 * Every piece. The shelf sorts by premiere; pieces that opened on the same
 * day keep the order they have here, so the first of a batch leads it.
 *
 * Adding one: finish it in its format first (`docs/reading-formats.md`), make
 * a cover with `cwebp -q 80 -m 6 -sharp_yuv -resize 720 0`, add a line here.
 * The test names what is missing if any of it is not done.
 */
export const seriesPieces: readonly SeriesPiece[] = [
  // The Halloween three, in the order they are meant to be heard: Poe for the
  // eye, Dickinson for the hand, Hardy to end on something human.
  {
    storyId: "0b94e076-f41d-4f81-a2d2-c1e1efe2d9e7",
    format: "poem",
    language: "en",
    title: "Spirits of the Dead",
    author: "Edgar Allan Poe",
    cover: "/series/spirits-of-the-dead.webp",
    coverFocus: "35% 40%",
    durationSeconds: 82,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-19",
  },
  {
    storyId: "8ec69ff8-473d-4fb9-a05d-92ae8567317a",
    format: "poem",
    language: "en",
    title: "One Need Not Be a Chamber to Be Haunted",
    author: "Emily Dickinson",
    cover: "/series/one-need-not-be-a-chamber.webp",
    coverFocus: "55% 35%",
    durationSeconds: 52,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-19",
  },
  {
    storyId: "89cf5983-6c4b-466a-b0e8-79ea30a7d418",
    format: "poem",
    language: "en",
    title: "The Shadow on the Stone",
    author: "Thomas Hardy",
    cover: "/series/shadow-on-the-stone.webp",
    coverFocus: "60% 40%",
    durationSeconds: 73,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-19",
  },
  {
    storyId: "abbf65a4-b64b-4d8d-aa92-2f3aee583b5a",
    format: "poem",
    language: "en",
    title: "Napoleon's Farewell",
    author: "Lord Byron",
    cover: "/series/napoleons-farewell.webp",
    coverFocus: "30% 45%",
    durationSeconds: 95,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-14",
  },
  {
    storyId: "45035e98-5bbf-4f3f-bb1b-f88f2bc02ac2",
    format: "poem",
    language: "en",
    title: "The Arrow and the Song",
    author: "Henry Wadsworth Longfellow",
    cover: "/series/arrow-and-song.webp",
    coverFocus: "40% 45%",
    durationSeconds: 39,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-14",
  },
  {
    storyId: "011660ae-2795-4b28-bd77-0404a4a2a8ba",
    format: "poem",
    language: "en",
    title: "A Noiseless Patient Spider",
    author: "Walt Whitman",
    cover: "/series/noiseless-spider.webp",
    coverFocus: "35% 45%",
    durationSeconds: 48,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-14",
  },
  {
    storyId: "7cf8f28a-3d1a-49df-a4bb-b10a274e5347",
    format: "poem",
    language: "en",
    title: "There is no Frigate like a Book",
    author: "Emily Dickinson",
    cover: "/series/no-frigate.webp",
    coverFocus: "35% 55%",
    durationSeconds: 23,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-14",
  },
  {
    storyId: "e07795ca-f5ee-4472-8646-f9dc64736c91",
    format: "poem",
    language: "en",
    title: "Because She Would Ask Me Why I Loved Her",
    author: "Christopher Brennan",
    cover: "/series/why-i-loved-her.webp",
    coverFocus: "50% 45%",
    durationSeconds: 56,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-13",
  },
  {
    storyId: "8e2ae832-c00c-43f0-ba4b-0acd5653df03",
    format: "poem",
    language: "en",
    title: "Australia",
    author: "Bernard O'Dowd",
    cover: "/series/australia.webp",
    coverFocus: "50% 40%",
    durationSeconds: 50,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-13",
  },
  {
    storyId: "dc5150c6-fb9b-417c-8b29-40d274103acc",
    format: "poem",
    language: "en",
    title: "Song of the Redwood-Tree — Part 1",
    author: "Walt Whitman",
    cover: "/series/redwood-tree.webp",
    coverFocus: "50% 40%",
    durationSeconds: 379,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-11",
  },
  {
    storyId: "afa5a1ed-3019-455e-b550-475c9a498db3",
    format: "poem",
    language: "en",
    title: "The Old Vicarage, Grantchester",
    author: "Rupert Brooke",
    cover: "/series/grantchester.webp",
    coverFocus: "60% 45%",
    durationSeconds: 363,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-11",
  },
  {
    storyId: "99ee280f-faf5-4026-99fc-9cbec9d79a2a",
    format: "poem",
    language: "en",
    title: "Binsey Poplars",
    author: "Gerard Manley Hopkins",
    cover: "/series/binsey-poplars.webp",
    coverFocus: "36% 50%",
    durationSeconds: 63,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-11",
  },
  {
    storyId: "7082de8a-56c4-441e-82d2-2c1ecb3c2d2c",
    format: "poem",
    language: "ru",
    title: "Не жалею, не зову, не плачу…",
    author: "Сергей Есенин",
    cover: "/series/ne-zhaleyu.webp",
    coverFocus: "55% 40%",
    durationSeconds: 49,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-04",
  },
  {
    storyId: "7a67ce67-bceb-4e41-8f66-191718345880",
    format: "poem",
    language: "ru",
    title: "Первый снег",
    author: "Валерий Брюсов",
    cover: "/series/perviy-sneg.webp",
    coverFocus: "55% 55%",
    durationSeconds: 32,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-04",
  },
  {
    storyId: "8ca3bef0-9aa2-4d43-a21b-b9c3ed756aca",
    format: "poem",
    language: "ru",
    title: "Узник",
    author: "Александр Пушкин",
    cover: "/series/uznik.webp",
    coverFocus: "55% 35%",
    durationSeconds: 32,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-04",
  },
  {
    storyId: "af757f35-36d7-48b6-8db3-51c8bffaffb6",
    format: "poem",
    language: "ru",
    title: "Утёс",
    author: "Михаил Лермонтов",
    cover: "/series/utyos.webp",
    coverFocus: "50% 35%",
    durationSeconds: 18,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-04",
  },
  {
    storyId: "1d2e5f7a-2501-466c-a583-0b2dade47571",
    format: "poem",
    language: "ru",
    title: "Шёпот, робкое дыханье…",
    author: "Афанасий Фет",
    cover: "/series/shepot.webp",
    coverFocus: "35% 65%",
    durationSeconds: 21,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-04",
  },
  {
    storyId: "9db4cce3-9594-4a6c-a860-324a330e89f8",
    format: "poem",
    language: "ru",
    title: "Мужичок с ноготок",
    author: "Николай Некрасов",
    cover: "/series/muzhichok.webp",
    coverFocus: "60% 60%",
    durationSeconds: 55,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-04",
  },
  {
    storyId: "da98c07c-3386-48b4-8d1f-be02a1ff6d74",
    format: "poem",
    language: "en",
    title: "Remember",
    author: "Christina Rossetti",
    cover: "/series/remember.webp",
    coverFocus: "60% 40%",
    durationSeconds: 41,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-04",
  },
  {
    storyId: "d86fa888-50ab-493d-ae34-8ad574fc0845",
    format: "poem",
    language: "en",
    title: "Ozymandias",
    author: "Percy Bysshe Shelley",
    cover: "/series/ozymandias.webp",
    coverFocus: "65% 50%",
    durationSeconds: 51,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-04",
  },
  {
    storyId: "c8e05b68-5a45-4eb0-935e-d8b0ad8e6b45",
    format: "poem",
    language: "en",
    title: "Invictus",
    author: "William Ernest Henley",
    cover: "/series/invictus.webp",
    coverFocus: "35% 40%",
    durationSeconds: 45,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-04",
  },
  {
    storyId: "9d42d01d-5a3e-4ddb-a334-3f4dfdf5dffe",
    format: "poem",
    language: "en",
    title: "The Lake Isle of Innisfree",
    author: "W. B. Yeats",
    cover: "/series/innisfree.webp",
    coverFocus: "55% 45%",
    durationSeconds: 49,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-04",
  },
  {
    storyId: "7322a7ff-0abf-4aba-b340-49477030ebed",
    format: "poem",
    language: "en",
    title: "O Captain! My Captain!",
    author: "Walt Whitman",
    cover: "/series/o-captain.webp",
    coverFocus: "40% 55%",
    durationSeconds: 88,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-04",
  },
  {
    storyId: "61ba3680-210d-41ed-acae-39710a5af5c8",
    format: "poem",
    language: "ru",
    title: "Зимнее утро",
    author: "Александр Пушкин",
    cover: "/series/winter-morning.webp",
    coverFocus: "62% 40%",
    durationSeconds: 62,
    scenes: 5,
    moments: 0,
    premieredOn: "2026-10-04",
  },
  {
    storyId: "a49896d0-be71-4b1a-9380-590738af79a2",
    format: "poem",
    language: "ru",
    title: "Весенняя гроза",
    author: "Фёдор Тютчев",
    cover: "/series/spring-storm.webp",
    coverFocus: "60% 30%",
    durationSeconds: 34,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-04",
  },
  {
    storyId: "c85132ea-8f0b-495f-a468-c3339c624fa2",
    format: "poem",
    language: "ru",
    title: "Ночь, улица, фонарь, аптека…",
    author: "Александр Блок",
    cover: "/series/night-street.webp",
    coverFocus: "55% 35%",
    durationSeconds: 20,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-04",
  },
  {
    storyId: "11cbb669-6c1b-4e03-a80a-27951c9abca9",
    format: "poem",
    language: "en",
    title: "The Tyger",
    author: "William Blake",
    cover: "/series/tyger.webp",
    coverFocus: "50% 45%",
    durationSeconds: 65,
    scenes: 5,
    moments: 0,
    premieredOn: "2026-10-04",
  },
  {
    storyId: "9aa49ad9-579e-4721-881d-d84595a49975",
    format: "poem",
    language: "en",
    title: "A Dream Within a Dream",
    author: "Edgar Allan Poe",
    cover: "/series/dream-parting-kiss.webp",
    coverFocus: "42% 40%",
    durationSeconds: 55,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-04",
  },
  {
    storyId: "226ea7f3-9aa8-4c2f-b654-01ee67b53fb2",
    format: "poem",
    language: "en",
    title: "Hope is the thing with feathers",
    author: "Emily Dickinson",
    cover: "/series/hope-feathers.webp",
    coverFocus: "45% 35%",
    durationSeconds: 28,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-04",
  },
  {
    storyId: "ee470590-a93c-467e-aaeb-87ae00c0745e",
    format: "cinema",
    language: "ru",
    title: "Лев и собачка",
    author: "Лев Толстой",
    cover: "/series/lion.webp",
    coverFocus: "38% 30%",
    durationSeconds: 127,
    scenes: 6,
    moments: 2,
    premieredOn: "2026-09-30",
  },
  {
    storyId: "202c3d9c-5a8e-4c91-8278-ab0fc4e602cf",
    format: "poem",
    language: "en",
    title: "The New Colossus",
    author: "Emma Lazarus",
    cover: "/series/colossus.webp",
    coverFocus: "30% 28%",
    durationSeconds: 49,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-03",
  },
  {
    storyId: "3056ee24-d8c0-4963-923f-967213a3ec34",
    format: "poem",
    language: "en",
    title: "I Hear America Singing",
    author: "Walt Whitman",
    cover: "/series/america.webp",
    coverFocus: "50% 40%",
    durationSeconds: 61,
    scenes: 4,
    moments: 0,
    premieredOn: "2026-10-03",
  },
];

const byStoryId = new Map(seriesPieces.map((piece) => [piece.storyId, piece]));

export function seriesPieceFor(storyId: string | null | undefined): SeriesPiece | null {
  return storyId ? (byStoryId.get(storyId) ?? null) : null;
}

/** The format a boks is opened in, from the registries that actually open it. */
export function seriesFormatOf(storyId: string): SeriesFormat | null {
  if (poemManifestFor(storyId)) return "poem";
  if (isBoksSeriesPiece(storyId)) return "cinema";
  return null;
}

/**
 * A seasonal collection: a few pieces meant to be heard together, in a set
 * order, shown first on the shelf for a while and then gone.
 *
 * Its name and line live in `series-view.tsx`'s message table under `id`, so
 * they come in every interface language. While it is up, its pieces appear in
 * it and nowhere else on the shelf; the visible order - collection first - is
 * also the order Series next walks.
 */
export type SeriesCollection = {
  id: "halloween";
  /** In the order they are meant to be heard. */
  storyIds: readonly string[];
  /** First day shown, and the first day it is no longer shown, `YYYY-MM-DD`, in the reader's own calendar. */
  from: string;
  until: string;
};

export const seriesCollections: readonly SeriesCollection[] = [
  {
    // Poe for the eye, Dickinson for the hand, Hardy to end on something human.
    id: "halloween",
    storyIds: [
      "0b94e076-f41d-4f81-a2d2-c1e1efe2d9e7",
      "8ec69ff8-473d-4fb9-a05d-92ae8567317a",
      "89cf5983-6c4b-466a-b0e8-79ea30a7d418",
    ],
    from: "2026-10-17",
    until: "2026-11-03",
  },
];

/** The reader's own calendar day, `YYYY-MM-DD`. Halloween is local. */
export function localDay(today: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

/** The collection up today, if any. */
export function activeCollection(
  today: Date,
  collections: readonly SeriesCollection[] = seriesCollections
): SeriesCollection | null {
  const day = localDay(today);
  return collections.find((collection) => collection.from <= day && day < collection.until) ?? null;
}

/**
 * The shelf as drawn: the collection, the piece that leads, the rest.
 *
 * The collection keeps its own order whatever has been heard, and only shows
 * what is published and in the reader's languages. Fewer than two of its
 * pieces left is not a collection, and they go back to the ordinary shelf.
 * `order` is everything in the order it appears.
 */
export function arrangeSeriesShelf(shelf: readonly SeriesPiece[], collection: SeriesCollection | null) {
  const byId = new Map(shelf.map((piece) => [piece.storyId, piece]));
  const gathered = (collection?.storyIds ?? []).flatMap((storyId) => byId.get(storyId) ?? []);
  const together = gathered.length >= 2 ? gathered : [];
  const inside = new Set(together.map((piece) => piece.storyId));
  const [lead = null, ...rest] = shelf.filter((piece) => !inside.has(piece.storyId));
  return {
    collection: together.length ? { id: collection!.id, pieces: together } : null,
    lead,
    rest,
    order: [...together, ...(lead ? [lead] : []), ...rest],
  };
}

/** How many days a piece is a premiere for. */
export const premiereDays = 14;

export function isPremiere(piece: SeriesPiece, today: Date) {
  const opened = Date.parse(`${piece.premieredOn}T00:00:00Z`);
  return today.getTime() - opened < premiereDays * 86_400_000;
}

/**
 * The shelf, in the order it is shown.
 *
 * Every language by default: the shelf is small and a production is pictures
 * and a voice as much as words. A reader narrows it with the shelf's own
 * language filter (`languages`); an empty filter is "all", never "none". The
 * newest first, and a piece already heard drops behind the ones not yet heard
 * - the shelf is for what to listen to next.
 */
export function orderSeries(
  pieces: readonly SeriesPiece[],
  languages: readonly string[],
  heard: ReadonlySet<string>
): SeriesPiece[] {
  const accepted = new Set(languages);
  const reads = (piece: SeriesPiece) => accepted.size === 0 || accepted.has(piece.language);
  const sorted = [...pieces].sort((a, b) => {
    const heardOrder = Number(heard.has(a.storyId)) - Number(heard.has(b.storyId));
    if (heardOrder) return heardOrder;
    if (a.premieredOn !== b.premieredOn) return a.premieredOn < b.premieredOn ? 1 : -1;
    return 0;
  });
  return sorted.filter(reads);
}

/** The languages on the shelf, most pieces first, with how many each has. */
export function seriesLanguages(pieces: readonly SeriesPiece[]): { language: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const piece of pieces) counts.set(piece.language, (counts.get(piece.language) ?? 0) + 1);
  return [...counts]
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));
}

/**
 * A filter that names only languages the shelf no longer has would hide
 * everything; one that names every language it has is no filter. Both become
 * "all".
 */
export function effectiveSeriesFilter(filter: readonly string[], available: readonly string[]): string[] {
  const kept = filter.filter((language) => available.includes(language));
  return kept.length === 0 || kept.length === available.length ? [] : kept;
}

const seriesFilterKey = "boks-series-languages";

/** The shelf's filter is a view preference, kept on this device. */
export function storedSeriesFilter(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(seriesFilterKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export function rememberSeriesFilter(languages: readonly string[]) {
  try {
    window.localStorage.setItem(seriesFilterKey, JSON.stringify(languages));
  } catch {
    // Private mode: the filter still holds for this visit.
  }
}

/** The same published, language-filtered order drives the shelf and its Next. */
export function publishedSeriesShelf(
  catalogue: ReadonlyMap<string, { title: string; authorName: string }> | null,
  readerLanguages: readonly string[],
  heard: ReadonlySet<string>,
  registry: readonly SeriesPiece[] = seriesPieces,
): SeriesPiece[] {
  if (!catalogue) return [];
  const published = registry.filter((piece) => catalogue.has(piece.storyId)).map((piece) => {
    const row = catalogue.get(piece.storyId)!;
    return { ...piece, title: row.title || piece.title, author: row.authorName || piece.author };
  });
  return orderSeries(published, readerLanguages, heard);
}

/** "2 min", "49 sec": a piece under a minute says so rather than rounding up. */
export function seriesDurationLabel(seconds: number, language: UiLanguage = "en") {
  const ru = language === "ru";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} ${ru ? "сек" : "sec"}`;
  return `${Math.round(seconds / 60)} ${ru ? "мин" : "min"}`;
}

/**
 * What a piece is made of, in the words on its card: "Voice · 6 scenes ·
 * 2 interactive moments". Only what differs between pieces - every piece on
 * the shelf has a voice and pictures, so moments are named only where there
 * are some.
 */
export function seriesFeatures(piece: SeriesPiece, language: UiLanguage = "en"): string[] {
  if (language === "ru") {
    const scenes = plural("ru", piece.scenes, { one: "сцена", few: "сцены", many: "сцен", other: "сцены" });
    const features = ["Голос", `${piece.scenes} ${scenes}`];
    if (piece.moments > 0) {
      const moments = plural("ru", piece.moments, {
        one: "интерактивный момент",
        few: "интерактивных момента",
        many: "интерактивных моментов",
        other: "интерактивных момента",
      });
      features.push(`${piece.moments} ${moments}`);
    }
    return features;
  }
  const features = ["Voice", `${piece.scenes} ${piece.scenes === 1 ? "scene" : "scenes"}`];
  if (piece.moments > 0) {
    features.push(`${piece.moments} interactive ${piece.moments === 1 ? "moment" : "moments"}`);
  }
  return features;
}

/** A short "А. П. Чехов" style byline does not fit every name; initials do. */
export function shortAuthor(author: string) {
  const parts = author.trim().split(/\s+/);
  if (parts.length < 2) return author;
  const last = parts[parts.length - 1];
  const initials = parts
    .slice(0, -1)
    .map((part) => `${part[0]}.`)
    .join(" ");
  return `${initials} ${last}`;
}

