/** Bump when the poster changes so new shares do not reuse an old messenger card. */
export const sharePosterVersion = "v44-7";

/**
 * Where shared links point. Telegram builds a link's preview on its servers
 * abroad, which cannot reach the site in Russia, so the app shares
 * `go.tryboks.com`: a Cloudflare Worker that answers preview bots and sends a
 * person straight on to tryboks.com (`deploy/link-preview`, docs/hosting.md).
 * Anywhere but production - a local build, a preview - links stay on the page's
 * own origin.
 */
export const shareOriginProduction = "https://go.tryboks.com";

export function shareOrigin(origin: string) {
  try {
    const host = new URL(origin).hostname;
    return host === "tryboks.com" || host === "www.tryboks.com" || host === "go.tryboks.com" ? shareOriginProduction : origin;
  } catch {
    return origin;
  }
}

/** `go.tryboks.com/b/neznakomka-blok`; by id while the slug is not known yet - both open the bok. */
export function bokShareUrl(bok: { id: string; slug?: string | null }, origin: string) {
  return new URL(`/b/${encodeURIComponent(bok.slug || bok.id)}`, shareOrigin(origin)).href;
}

/** `go.tryboks.com/@prokhorov`: an author's page. */
export function authorShareUrl(handle: string, origin: string) {
  return new URL(`/@${encodeURIComponent(handle.replace(/^@+/, ""))}`, shareOrigin(origin)).href;
}

/** Where `/@handle` is served from: the author page, `/a/handle`. Null for any other path. */
export function authorPathTarget(url: URL) {
  const handle = /^\/@([A-Za-z0-9_.-]{1,40})\/?$/.exec(url.pathname)?.[1];
  return handle ? new URL(`/a/${handle}${url.search}`, url) : null;
}
