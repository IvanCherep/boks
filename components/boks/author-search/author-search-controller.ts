/**
 * Author search: what one search box asks the server and when.
 *
 * Owns one pending request and one timer, never a catalogue: the server
 * (`search_boks_authors`) answers a bounded page, and nothing else is kept.
 * Typing waits 250 ms before asking; a new query aborts the old request, and
 * a revision check drops a late answer even when the transport ignores the
 * abort. A request that hangs fails at eight seconds, so "Try again" is never
 * behind an endless "Searching...".
 *
 * Ported from the handoff of 2026-11-24 (boks-author-search-platform), where
 * it was plain JavaScript with node:test cases; the cases are in the test file.
 */

/** A target comes from a server result, never from a guessed handle. */
export type AuthorSearchTarget =
  | { kind: "byline"; accountHandle: string; byline: string }
  | { kind: "account"; handle: string };

/** No work title, summary or count is part of a search row. */
export type AuthorSearchResult = {
  target: AuthorSearchTarget;
  displayName: string;
  avatarUrl: string | null;
};

export type AuthorSearchPage = {
  results: readonly AuthorSearchResult[];
  hasMore: boolean;
};

export type AuthorSearchAdapter = (
  query: string,
  options: { signal: AbortSignal; limit: number },
) => Promise<AuthorSearchPage>;

export type AuthorSearchSnapshot = {
  phase: "idle" | "loading" | "ready" | "error";
  query: string;
  results: readonly AuthorSearchResult[];
  hasMore: boolean;
};

export const AUTHOR_SEARCH_LIMIT = 20;
export const AUTHOR_SEARCH_QUERY_LIMIT = 100;
export const AUTHOR_SEARCH_DEBOUNCE_MS = 250;
export const AUTHOR_SEARCH_TIMEOUT_MS = 8000;

/** Stable, and different for an account and for a writer of the same account. */
export function authorSearchTargetKey(target: AuthorSearchTarget): string {
  return target.kind === "byline"
    ? JSON.stringify(["byline", target.accountHandle, target.byline])
    : JSON.stringify(["account", target.handle]);
}

type Timer = ReturnType<typeof setTimeout>;

export function createAuthorSearchController({
  search,
  onState,
  debounceMs = AUTHOR_SEARCH_DEBOUNCE_MS,
  timeoutMs = AUTHOR_SEARCH_TIMEOUT_MS,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
}: {
  search: AuthorSearchAdapter;
  onState: (snapshot: AuthorSearchSnapshot) => void;
  debounceMs?: number;
  timeoutMs?: number;
  setTimer?: (callback: () => void, delay: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}) {
  let revision = 0;
  let alive = true;
  let timer: Timer | null = null;
  let request: AbortController | null = null;
  let deadline: Timer | null = null;
  let query = "";

  function cancelPending() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (deadline !== null) clearTimer(deadline);
    deadline = null;
    request?.abort();
    request = null;
  }

  function publish(phase: AuthorSearchSnapshot["phase"], results: readonly AuthorSearchResult[] = [], hasMore = false) {
    if (alive) onState({ phase, query, results, hasMore });
  }

  async function run(ownRevision: number) {
    timer = null;
    if (!alive || ownRevision !== revision) return;
    const ownRequest = new AbortController();
    request = ownRequest;
    const ownDeadline = setTimer(() => {
      if (!alive || ownRevision !== revision) return;
      revision += 1;
      ownRequest.abort();
      request = null;
      deadline = null;
      publish("error");
    }, timeoutMs);
    deadline = ownDeadline;
    try {
      const page = await search(query, { signal: ownRequest.signal, limit: AUTHOR_SEARCH_LIMIT });
      if (!alive || ownRevision !== revision || ownRequest.signal.aborted) return;
      if (!page || !Array.isArray(page.results)) throw new Error("Invalid author search page");
      const rows: AuthorSearchResult[] = [];
      const keys = new Set<string>();
      for (const row of page.results) {
        const key = authorSearchTargetKey(row.target);
        if (!keys.has(key)) { rows.push(row); keys.add(key); }
        if (rows.length === AUTHOR_SEARCH_LIMIT) break;
      }
      publish("ready", rows, Boolean(page.hasMore) || page.results.length > AUTHOR_SEARCH_LIMIT);
    } catch {
      if (alive && ownRevision === revision && !ownRequest.signal.aborted) publish("error");
    } finally {
      clearTimer(ownDeadline);
      if (deadline === ownDeadline) deadline = null;
      if (request === ownRequest) request = null;
    }
  }

  function setQuery(value: string, { immediate = false }: { immediate?: boolean } = {}) {
    if (!alive) return;
    revision += 1;
    cancelPending();
    query = String(value).slice(0, AUTHOR_SEARCH_QUERY_LIMIT).trim();
    const ownRevision = revision;
    // Results of another query are never left clickable while loading.
    publish("loading");
    if (immediate) void run(ownRevision);
    else timer = setTimer(() => { void run(ownRevision); }, debounceMs);
  }

  return {
    setQuery,
    retry() { setQuery(query, { immediate: true }); },
    dispose() {
      if (!alive) return;
      alive = false;
      revision += 1;
      cancelPending();
    },
  };
}
