/**
 * What the address bar says while reading, so a refresh - or a copied
 * address - lands where the reader was (2026-11-09):
 * - an author's page is `/@handle`;
 * - a bok opened on its own (a shared link, from an author's page) is
 *   `/b/<slug>` until the reader moves on in the feed;
 * - the feed is `/`, the shelf `/series`.
 * Both `/@handle` and `/b/<slug>` are real pages (`app/a/[handle]`,
 * `app/b/[id]`) that hand the reader back the same view.
 */
const handleShape = /^[A-Za-z0-9_.-]{1,40}$/;

export function authorPath(handle: string) {
  return `/@${handle.replace(/^@+/, "")}`;
}

/** The handle an author address names, or null. */
export function authorFromPath(pathname: string) {
  const handle = /^\/@([^/]+)\/?$/.exec(pathname)?.[1];
  if (!handle) return null;
  let bare = handle;
  try { bare = decodeURIComponent(handle); } catch { /* read as it is */ }
  return handleShape.test(bare) ? bare : null;
}

export function bokPath(ref: string) {
  return `/b/${encodeURIComponent(ref)}`;
}

export function isBokPath(pathname: string) {
  return /^\/b\/[^/]+\/?$/.test(pathname);
}
