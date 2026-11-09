import { authorPortraitFor } from "@/components/boks/author-portraits";

/**
 * Preview lab (temporary, 2026-11-09): one author page under several hidden
 * addresses, `/p/<slug>`, each previewing in messengers with a different
 * card - bookmark, square, poster, animated GIF, video - so the team can
 * post them in Telegram, VK, OK, WhatsApp, Max, Facebook and see which format
 * works. A person who opens one lands on the author's page.
 *
 * Nothing links here except Studio -> Links -> Preview lab. The cards show the
 * author's photo, so they live in his link-only folder, never in this public
 * repository (`docs/link-only-pieces.md`). Delete this file, `app/p/` and
 * `components/boks/admin/preview-lab.tsx` once a format is chosen.
 */
export type PreviewLabVariant = {
  slug: string;
  /** What it is, for the admin list. */
  name: { en: string; ru: string };
  /** The question this card answers. */
  note: { en: string; ru: string };
  image: { file: string; width: number; height: number; type: "image/jpeg" | "image/gif" | "image/webp"; kb: number };
  /** An `og:video` beside the picture: Telegram and a few others play it. */
  video?: { file: string; width: number; height: number; type: "video/mp4"; kb: number };
};

export const previewLabAuthor = "prokhorov";

export const previewLabVariants: readonly PreviewLabVariant[] = [
  {
    slug: "zakladka-lubok",
    name: { en: "Bookmark, folk", ru: "Закладка, народная" },
    note: { en: "Tall 2:5, embroidery ornament. How does a tall card crop?", ru: "Высокая 2:5, вышивка. Как режется вертикальная карточка?" },
    image: { file: "lab-bookmark-folk-share.jpg", width: 600, height: 1500, type: "image/jpeg", kb: 94 },
  },
  {
    slug: "zakladka-strogo",
    name: { en: "Bookmark, strict", ru: "Закладка, строгая" },
    note: { en: "Tall 2:5, Swiss typography, one red dot.", ru: "Высокая 2:5, строгая типографика, одна красная точка." },
    image: { file: "lab-bookmark-strict-share.jpg", width: 600, height: 1500, type: "image/jpeg", kb: 52 },
  },
  {
    slug: "zakladka-gif",
    name: { en: "Bookmark, animated", ru: "Закладка, анимированная" },
    note: { en: "GIF 480x1200: the ornament stitches itself. Does a GIF move in the preview?", ru: "GIF 480x1200: орнамент вышивается. Двигается ли GIF в превью?" },
    image: { file: "lab-bookmark-gif-share.gif", width: 480, height: 1200, type: "image/gif", kb: 238 },
  },
  {
    slug: "zakladka-na-stole",
    name: { en: "Bookmarks on a wide card", ru: "Закладки на широкой карточке" },
    note: { en: "Standard 1200x630 with both bookmarks lying on it: the safe way to show a bookmark everywhere.", ru: "Стандарт 1200x630, на нём лежат обе закладки: безопасный способ показать закладку везде." },
    image: { file: "lab-bookmark-wide-share.jpg", width: 1200, height: 630, type: "image/jpeg", kb: 83 },
  },
  {
    slug: "kvadrat-portret",
    name: { en: "Square, portrait", ru: "Квадрат, портрет" },
    note: { en: "1080x1080 full-bleed photo and name.", ru: "1080x1080, фото во весь кадр и имя." },
    image: { file: "lab-square-portrait-share.jpg", width: 1080, height: 1080, type: "image/jpeg", kb: 100 },
  },
  {
    slug: "kvadrat-stih",
    name: { en: "Square, poem", ru: "Квадрат, стихи" },
    note: { en: "1080x1080, four lines of «Коса», no photo but a small signature.", ru: "1080x1080, четыре строки «Косы», вместо фото маленькая подпись." },
    image: { file: "lab-square-poem-share.jpg", width: 1080, height: 1080, type: "image/jpeg", kb: 57 },
  },
  {
    slug: "plakat-avangard",
    name: { en: "Poster 4:5, avant-garde", ru: "Плакат 4:5, авангард" },
    note: { en: "1080x1350, red wedge and bold type, Rodchenko-like.", ru: "1080x1350, красный клин и рубленый шрифт, в духе Родченко." },
    image: { file: "lab-vertical-avantgarde-share.jpg", width: 1080, height: 1350, type: "image/jpeg", kb: 99 },
  },
  {
    slug: "shirokiy-smelo",
    name: { en: "Wide, loud", ru: "Широкая, громкая" },
    note: { en: "1200x630, huge type on red, red duotone photo.", ru: "1200x630, огромные буквы на красном, фото в красном дуотоне." },
    image: { file: "lab-wide-bold-share.jpg", width: 1200, height: 630, type: "image/jpeg", kb: 57 },
  },
  {
    slug: "malenkaya",
    name: { en: "Small, 400x400", ru: "Маленькая, 400x400" },
    note: { en: "A small picture: does the messenger switch to a compact preview with a thumbnail?", ru: "Маленькая картинка: переключается ли мессенджер на компактное превью с миниатюрой?" },
    image: { file: "lab-mini-share.jpg", width: 400, height: 400, type: "image/jpeg", kb: 22 },
  },
  {
    slug: "gif-stih",
    name: { en: "Animated GIF, poem", ru: "Анимированный GIF, стихи" },
    note: { en: "800x420 GIF, lines appear one by one. First frame is the name card, for apps that show only it.", ru: "GIF 800x420, строки появляются по одной. Первый кадр с именем: для тех, кто показывает только его." },
    image: { file: "lab-gif-share.gif", width: 800, height: 420, type: "image/gif", kb: 715 },
  },
  {
    slug: "webp-stih",
    name: { en: "Animated WebP, poem", ru: "Анимированный WebP, стихи" },
    note: { en: "Same animation as WebP, half the weight. Many apps refuse WebP: does anyone show it?", ru: "Та же анимация в WebP, вдвое легче. Многие не берут WebP: кто покажет?" },
    image: { file: "lab-webp-share.webp", width: 800, height: 420, type: "image/webp", kb: 377 },
  },
  {
    slug: "video",
    name: { en: "Video (og:video)", ru: "Видео (og:video)" },
    note: { en: "MP4 1200x630, 9.5 s, silent, plus a still poster. Telegram may play it in the chat.", ru: "MP4 1200x630, 9,5 с, без звука, плюс статичный постер. Telegram может проиграть его прямо в чате." },
    image: { file: "lab-video-poster-share.jpg", width: 1200, height: 630, type: "image/jpeg", kb: 46 },
    video: { file: "lab-video-share.mp4", width: 1200, height: 630, type: "video/mp4", kb: 199 },
  },
];

export function previewLabVariant(slug: string | null | undefined) {
  return previewLabVariants.find((variant) => variant.slug === slug) ?? null;
}

/** Where a card's file is served: the author's link-only folder, same origin. */
export function previewLabFilePath(file: string) {
  const folder = authorPortraitFor(previewLabAuthor)?.photo.match(/^(\/l\/[^/]+\/f\/)/)?.[1];
  return folder ? `${folder}${file}` : null;
}
