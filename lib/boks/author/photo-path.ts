/**
 * The address of an author's photo at the size a screen shows it. The sizes
 * themselves are made on the server (`photo-sizes.ts`); this module stays free
 * of the JPEG codec so the browser bundle does not carry it.
 *
 *   "s"   192 px, avatars up to 64 CSS px (shelf, search, follows, sheet)
 *   "l"   1080 px, the portrait and the curtain
 *   none  the stored original (link previews, server-drawn cards)
 */
export type PhotoSize = "s" | "l";

export function photoSizeOf(value: string | null | undefined): PhotoSize | null {
  return value === "s" || value === "l" ? value : null;
}

/** The address of a page's photo at a size; null without a photo. */
export function authorPhotoPath(handle: string, version: number | null | undefined, size?: PhotoSize): string | null {
  if (!version) return null;
  return `/a/${encodeURIComponent(handle)}/photo?v=${version}${size ? `&s=${size}` : ""}`;
}
