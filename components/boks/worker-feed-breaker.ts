/**
 * A circuit breaker for the Worker feed (`/api/feed`).
 *
 * Ranking belongs to the Worker (ADR-001), and the browser ranks through the
 * same `serveReaderFeed` when the Worker cannot. On 2026-09-19 the Worker began
 * failing every feed request with Cloudflare's "Worker exceeded resource
 * limits" (the Free plan's 10 ms CPU per request) - and every page load, and
 * every reload after a like, still asked it first and waited 0.5-3 s for the
 * 503 before ranking in the browser. With Supabase slow at the same time, the
 * reader sat on "Loading".
 *
 * So one failure opens the breaker: for the next `cooldownMs` this browser
 * goes straight to browser ranking, then tries the Worker again. Nothing is
 * decided here about where ranking should live - when the Worker is healthy
 * again (a paid plan, a lighter ranking), the next probe finds it and every
 * serve goes back to it on its own.
 */

export const workerFeedCooldownMs = 15 * 60 * 1000;
/** A Worker that has not answered by now is treated as unavailable. */
export const workerFeedTimeoutMs = 4000;

const storageKey = "boks-worker-feed-unavailable-until";

type BreakerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): BreakerStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Whether the Worker should be asked for this feed. */
export function shouldTryWorkerFeed(now = Date.now(), storage: BreakerStorage | null = defaultStorage()) {
  try {
    const until = Number(storage?.getItem(storageKey) ?? 0);
    return !Number.isFinite(until) || until <= now;
  } catch {
    return true;
  }
}

/** The Worker failed: skip it until the cooldown has passed. */
export function markWorkerFeedUnavailable(now = Date.now(), storage: BreakerStorage | null = defaultStorage()) {
  try {
    storage?.setItem(storageKey, String(now + workerFeedCooldownMs));
  } catch {
    // Private mode or a full quota: the breaker simply stays closed.
  }
}

/** The Worker served a feed: nothing to skip. */
export function markWorkerFeedHealthy(storage: BreakerStorage | null = defaultStorage()) {
  try {
    storage?.removeItem(storageKey);
  } catch {
    // Nothing to clear.
  }
}
