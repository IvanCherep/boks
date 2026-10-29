/** Bump when the poster changes so new shares do not reuse an old messenger card. */
export const sharePosterVersion = "v44-5";

export function bokShareUrl(storyId: string, origin: string) {
  const url = new URL(`/b/${encodeURIComponent(storyId)}`, origin);
  url.searchParams.set("card", sharePosterVersion);
  return url.href;
}
