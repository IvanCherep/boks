/**
 * One address for boks: everything on the old host is sent to tryboks.com.
 *
 * `read.tryboks.workers.dev` serves the same Worker and was kept up because
 * sign-in links already in inboxes pointed at it. Keeping it *reachable* turned
 * out to be the bug. A sign-in link returns to the address it was requested
 * from, a session lives in the storage of one address, and so a reader who
 * happened to be on the old host - an old bookmark, an old link - signed in
 * there and stayed signed out on tryboks.com. Found in the auth log on
 * 2026-09-22: the request for the link came from the old host, the link went
 * back to it, and the account never appeared on tryboks.com.
 *
 * So pages on the old host redirect, permanently, with their path and query.
 * Two things are left alone. `/api/` - a tab opened on the old host before
 * this shipped keeps calling its own origin, and a redirect would break that
 * tab mid-read. And `/_next/` - the same tab still loads its chunks from where
 * its HTML came from.
 */
export const canonicalOrigin = "https://tryboks.com";
export const retiredHosts = new Set(["read.tryboks.workers.dev"]);

export function canonicalRedirect(url: URL, host: string | null | undefined): string | null {
  const name = (host ?? url.host).toLowerCase().split(":")[0];
  if (!retiredHosts.has(name)) return null;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) return null;
  return `${canonicalOrigin}${url.pathname}${url.search}`;
}
