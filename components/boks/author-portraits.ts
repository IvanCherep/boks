/**
 * Authors with a portrait page (design v48): a full-bleed photo, their name
 * set large, and their boks as a library of equal covers.
 *
 * There are no profile fields for a photo or a public name yet, so the few
 * authors who have one are registered here. The photo is the author's own, so
 * it is held in link-only storage (`docs/link-only-pieces.md`), never in this
 * public repository. An author not listed keeps the ordinary author sheet.
 */
export type AuthorPortrait = {
  handle: string;
  /** Set on two lines: the given name in italic, the family name large. */
  given: string;
  family: string;
  /** The full portrait, for the page. */
  photo: string;
  /** A small square of it, for the share sheet. */
  thumb: string;
  /** Where the face sits, for the phone's narrow crop. */
  focus?: string;
  /** The link preview card, 1200x630, for messengers (`app/a/[handle]/page.tsx`). */
  share?: string;
  /**
   * Other addresses that open this author's page, each with a preview of its
   * own: `/veroslov`, named after his book, previews as the book.
   */
  aliases?: readonly AuthorAlias[];
};

export type AuthorAlias = {
  slug: string;
  title: string;
  description: string;
  image: string;
  width: number;
  height: number;
  alt: string;
};

export const authorPortraits: readonly AuthorPortrait[] = [
  {
    handle: "prokhorov",
    given: "Алексей",
    family: "Прохоров",
    photo: "/l/XFKejQcwEa7M_7jI_1T6LA/f/prokhorov-portrait.webp",
    thumb: "/l/XFKejQcwEa7M_7jI_1T6LA/f/prokhorov.webp",
    focus: "52% 15%",
    share: "/l/XFKejQcwEa7M_7jI_1T6LA/f/prokhorov-share.jpg",
    aliases: [
      {
        // Named after his book, at the poet's wish; was the series shelf until 2026-11-09.
        slug: "veroslov",
        title: "«Верослов». Алексей Прохоров на boks",
        description:
          "Стихи из «Верослова» в новом формате: поэт читает сам, а картины и слова оживают в такт голосу. Послушайте на boks.",
        image: "/l/XFKejQcwEa7M_7jI_1T6LA/f/veroslov-book-share.jpg",
        width: 1024,
        height: 1024,
        alt: "Алексей Прохоров, «Верослов»",
      },
    ],
  },
];

export function authorPortraitFor(handle: string | null | undefined): AuthorPortrait | null {
  const bare = (handle ?? "").replace(/^@+/, "").toLowerCase();
  return authorPortraits.find((portrait) => portrait.handle === bare) ?? null;
}

/** The author and alias an address like `/veroslov` stands for, if it is one. */
export function authorAliasFor(slug: string | null | undefined): { portrait: AuthorPortrait; alias: AuthorAlias } | null {
  const name = (slug ?? "").toLowerCase();
  for (const portrait of authorPortraits) {
    const alias = portrait.aliases?.find((candidate) => candidate.slug === name);
    if (alias) return { portrait, alias };
  }
  return null;
}
