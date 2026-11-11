/**
 * Authors with a photo on their page (design v49). Every author gets the
 * page (`author-portrait-page.tsx`); one registered here gets their photo in
 * its rings instead of a medallion with initials, and a set public name.
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
  /** The curtain loop, 960x504 MP4, offered beside `share` as og:video (`scripts/curtain-preview.py`). */
  shareLoop?: string;
  /**
   * The picture of the ribbon link card (`lib/boks/ribbon.ts`): a wide image,
   * at least 1200 px across, and where its window sits (object-position, 0..1).
   */
  ribbonArt?: { path: string; position: { x: number; y: number } };
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
    // The curtain card (2026-11-10): his night portrait behind the boks curtain.
    share: "/l/XFKejQcwEa7M_7jI_1T6LA/f/prokhorov-curtain-share.jpg",
    shareLoop: "/l/XFKejQcwEa7M_7jI_1T6LA/f/prokhorov-curtain-share.mp4",
    // The ribbon card (2026-11-11, under test at /a/prokhorov/ribbon): his portrait on the dark moiré.
    ribbonArt: { path: "/l/XFKejQcwEa7M_7jI_1T6LA/f/prokhorov-ribbon-art.jpg", position: { x: 0.5, y: 0.5 } },
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
