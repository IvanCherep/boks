/**
 * A reading request: what a reader asked "Что почитать" for during this
 * pause. Not a taste setting and never stored on the account; it lives in
 * the reader's tab and expires after 30 minutes without activity.
 *
 * Form and author groups are strict: they decide what is eligible, in
 * retrieval (`get_recommendation_candidates`). The mood is soft: it never
 * empties the feed; boks that carry it go first, in the arm's own order
 * (`preferFacetMatches`). `docs/reading-facets.md` has the model.
 */

export type ReadingMood = "sad" | "fun" | "think";
export type ReadingFormat = "any" | "prose" | "poetry";
export type ReadingAuthorGroup = "classics" | "contemporary";

export type ReadingRequest = {
  mood: ReadingMood | null;
  format: ReadingFormat;
  authorGroups: ReadingAuthorGroup[];
};

export const readingMoods: readonly ReadingMood[] = ["sad", "fun", "think"];
export const readingFormats: readonly ReadingFormat[] = ["any", "prose", "poetry"];
export const readingAuthorGroups: readonly ReadingAuthorGroup[] = ["classics", "contemporary"];

/** Without activity for this long, a request is forgotten. */
export const readingRequestIdleMs = 30 * 60 * 1000;

export const emptyReadingRequest: ReadingRequest = Object.freeze({ mood: null, format: "any", authorGroups: [] }) as ReadingRequest;

/** Anything into a valid request: unknown values are dropped, never guessed. */
export function normalizeReadingRequest(raw: unknown): ReadingRequest {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mood = readingMoods.includes(value.mood as ReadingMood) ? (value.mood as ReadingMood) : null;
  const format = readingFormats.includes(value.format as ReadingFormat) ? (value.format as ReadingFormat) : "any";
  const groups = Array.isArray(value.authorGroups) ? value.authorGroups : [];
  // Fixed order, so two requests that mean the same compare equal.
  const authorGroups = readingAuthorGroups.filter((group) => groups.includes(group));
  return { mood, format, authorGroups };
}

export function isEmptyReadingRequest(request: ReadingRequest | null | undefined) {
  return !request || (!request.mood && request.format === "any" && request.authorGroups.length === 0);
}

export function sameReadingRequest(a: ReadingRequest | null | undefined, b: ReadingRequest | null | undefined) {
  const left = normalizeReadingRequest(a);
  const right = normalizeReadingRequest(b);
  return left.mood === right.mood && left.format === right.format && left.authorGroups.join() === right.authorGroups.join();
}

/** How many kinds of condition are set (the badge on the button): two author groups count once. */
export function activeConditionCount(request: ReadingRequest | null | undefined) {
  if (!request) return 0;
  return Number(Boolean(request.mood)) + Number(request.format !== "any") + Number(request.authorGroups.length > 0);
}

export type FacetQuery = Record<string, string[]>;

/** The strict facets for retrieval, or null when there are none. */
export function strictFacets(request: ReadingRequest | null | undefined): FacetQuery | null {
  if (!request) return null;
  const facets: FacetQuery = {};
  if (request.format !== "any") facets.format = [request.format];
  if (request.authorGroups.length) facets.author_group = [...request.authorGroups];
  return Object.keys(facets).length ? facets : null;
}

/** The preferred facets (the mood), or null. */
export function preferredFacets(request: ReadingRequest | null | undefined): FacetQuery | null {
  return request?.mood ? { mood: [request.mood] } : null;
}

/** Whether a bok's facets satisfy a query: every facet named shares a value. */
export function matchesFacets(facets: Readonly<Record<string, readonly string[]>> | undefined, query: FacetQuery | null) {
  if (!query) return true;
  return Object.entries(query).every(([key, wanted]) => (facets?.[key] ?? []).some((value) => wanted.includes(value)));
}

/**
 * Boks that carry the preferred facets first, each group in the order it came,
 * ranks renumbered from 0 as `buildReaderFeed` numbers them. Run on the ranked slate before it is recorded, so the
 * served feed is exactly what the reader sees; never reorder in the browser.
 */
export function preferFacetMatches<Entry extends { rank: number }>(
  entries: readonly Entry[],
  facetsOf: (entry: Entry) => Readonly<Record<string, readonly string[]>> | undefined,
  prefer: FacetQuery | null
): Entry[] {
  if (!prefer) return [...entries];
  const first = entries.filter((entry) => matchesFacets(facetsOf(entry), prefer));
  const rest = entries.filter((entry) => !matchesFacets(facetsOf(entry), prefer));
  return [...first, ...rest].map((entry, index) => ({ ...entry, rank: index }));
}

/** A request that has gone unused for too long is forgotten. */
export function expireReadingRequest(request: ReadingRequest, lastActivityAt: number | null, now = Date.now()): ReadingRequest {
  if (lastActivityAt === null || !Number.isFinite(lastActivityAt) || now - lastActivityAt >= readingRequestIdleMs) return emptyReadingRequest;
  return normalizeReadingRequest(request);
}
