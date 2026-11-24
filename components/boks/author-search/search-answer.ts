import type { AuthorSearchPage, AuthorSearchResult } from "./author-search-controller";
import { searchPortraitFor } from "./search-portraits";

/**
 * The answer of `search_boks_authors` as the panel's rows. A row the server
 * could not have meant (no handle, no name, a writer without a byline) is
 * dropped rather than guessed at.
 */
export function toAuthorSearchPage(answer: unknown): AuthorSearchPage {
  const raw = (answer ?? {}) as { results?: unknown; hasMore?: unknown };
  if (!Array.isArray(raw.results)) throw new Error("Invalid author search answer");
  const results: AuthorSearchResult[] = [];
  for (const item of raw.results as Array<Record<string, unknown>>) {
    const handle = typeof item?.handle === "string" ? item.handle.trim() : "";
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    const byline = typeof item?.byline === "string" && item.byline.trim() ? item.byline : null;
    const photoVersion = typeof item?.photoVersion === "number" && item.photoVersion > 0 ? item.photoVersion : null;
    if (!handle || !name) continue;
    if (item.kind === "byline") {
      if (!byline) continue;
      results.push({
        target: { kind: "byline", accountHandle: handle, byline },
        displayName: name,
        avatarUrl: searchPortraitFor({ kind: "byline", handle, photoVersion: null }),
      });
    } else if (item.kind === "account") {
      results.push({
        target: { kind: "account", handle },
        displayName: name,
        avatarUrl: searchPortraitFor({ kind: "account", handle, photoVersion }),
      });
    }
  }
  return { results, hasMore: raw.hasMore === true };
}
