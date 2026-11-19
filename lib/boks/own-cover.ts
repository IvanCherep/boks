/**
 * A bok's own picture, uploaded or drawn for it by its author
 * (`bok_covers`, `20261120100000_boks_author_direct_publishing.sql`). Served
 * by the app after the publication check; the version in the address changes
 * with every new picture, so a cached copy never outlives it.
 */
export function ownCoverPath(bokId: string, version: number | null | undefined, format: "webp" | "jpg"): string | null {
  if (!version || !Number.isInteger(version) || version < 1) return null;
  if (!/^[0-9a-f-]{36}$/i.test(bokId)) return null;
  return `/b/${bokId}/cover.${format}?v=${version}`;
}
