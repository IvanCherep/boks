import { poemManifestFor } from "@/components/boks/poetry/poems";
import { isBoksSeriesPiece } from "@/components/boks/cinema/series";

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

export type SeriesLanguage = "ru" | "en";

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
    cover: "/series/dream-within-dream.webp",
    coverFocus: "45% 35%",
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

/** How many days a piece is a premiere for. */
export const premiereDays = 14;

export function isPremiere(piece: SeriesPiece, today: Date) {
  const opened = Date.parse(`${piece.premieredOn}T00:00:00Z`);
  return today.getTime() - opened < premiereDays * 86_400_000;
}

/**
 * The shelf, in the order it is shown.
 *
 * Only the reader's languages, the same filter the feed applies: a piece read
 * aloud in a language the reader has not chosen is a picture with noise over
 * it. The newest first, and a piece already heard drops behind the ones not
 * yet heard - the shelf is for what to listen to next.
 */
export function orderSeries(
  pieces: readonly SeriesPiece[],
  readerLanguages: readonly string[],
  heard: ReadonlySet<string>
): SeriesPiece[] {
  const accepted = new Set(readerLanguages);
  // No language known is not a refusal of every language.
  const reads = (piece: SeriesPiece) => accepted.size === 0 || accepted.has(piece.language);
  const sorted = [...pieces].sort((a, b) => {
    const heardOrder = Number(heard.has(a.storyId)) - Number(heard.has(b.storyId));
    if (heardOrder) return heardOrder;
    if (a.premieredOn !== b.premieredOn) return a.premieredOn < b.premieredOn ? 1 : -1;
    return 0;
  });
  return sorted.filter(reads);
}

/** "2 min", "49 sec": a piece under a minute says so rather than rounding up. */
export function seriesDurationLabel(seconds: number) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec`;
  return `${Math.round(seconds / 60)} min`;
}

/**
 * What a piece is made of, in the words on its card: "Voice · 6 scenes ·
 * 2 interactive moments". Only what differs between pieces - every piece on
 * the shelf has a voice and pictures, so moments are named only where there
 * are some.
 */
export function seriesFeatures(piece: SeriesPiece): string[] {
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

