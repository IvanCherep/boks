import { authorPhotoPath } from "@/lib/boks/author/photo-path";

/**
 * The portrait of a search row: the photo the author set on their own page
 * (`/a/<handle>/photo?v=&s=s`, 192 px), named by the server through its version. Search
 * lists only authors with a page of their own (2026-11-25), so there is no
 * other source of faces; a page without a photo gets initials.
 */
export function searchPortraitFor(row: { kind: "account" | "byline"; handle: string; photoVersion: number | null }): string | null {
  if (row.kind !== "account" || !row.photoVersion) return null;
  return authorPhotoPath(row.handle, row.photoVersion, "s");
}
