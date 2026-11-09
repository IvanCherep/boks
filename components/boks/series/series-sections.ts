import type { SeriesCollection } from "@/components/boks/series/series-catalogue";

/**
 * Series sections with an address of their own, `/series/<slug>`, for their
 * author to share. The preview card is the author's picture, so it lives in a
 * link-only folder, not in this public repository (`docs/link-only-pieces.md`).
 */
export type SeriesSectionPage = {
  slug: string;
  /** Earlier addresses that still open it. */
  aliases: readonly string[];
  collection: SeriesCollection["id"];
  /** When set, the address opens this author alias (`author-portraits.ts`) instead of the shelf. */
  profileAlias?: string;
  share: { title: string; description: string; image: string; alt: string };
};

export const seriesSectionPages: readonly SeriesSectionPage[] = [
  {
    // Named after his book, at the poet's wish.
    slug: "veroslov",
    aliases: ["prokhorov"],
    collection: "prokhorov",
    // Since 2026-11-09 his link opens his author page, previewed as the book.
    profileAlias: "veroslov",
    share: {
      title: "«Верослов». Алексей Прохоров читает свои стихи",
      description:
        "Поэт читает сам. Голос, картины и слова, которые загораются в такт чтению: шесть стихотворений Алексея Прохорова в новом формате boks series. Нажмите и слушайте.",
      image: "/l/XFKejQcwEa7M_7jI_1T6LA/f/veroslov-share.jpg",
      alt: "Алексей Прохоров, «Верослов»",
    },
  },
];

/**
 * The section a path segment names. Read as the slug the segment *starts
 * with*, because Telegram glues text sent with a link onto it
 * (`/series/veroslovСлушайте`), and a glued link should still open.
 */
export function seriesSectionFromPath(segment: string): SeriesSectionPage | null {
  let name = segment;
  try {
    name = decodeURIComponent(segment);
  } catch {
    // A broken escape is read as it is.
  }
  name = name.toLowerCase();
  for (const page of seriesSectionPages) {
    for (const slug of [page.slug, ...page.aliases]) {
      if (name === slug || (name.startsWith(slug) && !/^[a-z0-9-]/.test(name.slice(slug.length)))) return page;
    }
  }
  return null;
}
