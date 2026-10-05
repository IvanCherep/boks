"use client";

import type { ReaderEvent, ReaderEventType } from "@/lib/boks/contracts";

/**
 * Buffers attributed reader events and flushes them in batches.
 *
 * Reading produces a burst of signals - impression, start, complete or skip,
 * plus reactions - and every one of them must carry the algorithm, experiment,
 * segment, feed rank and elapsed time or it is useless for comparing
 * strategies. Sending them one request at a time would put network latency in
 * the middle of a swipe, so the reader records into this queue and the queue
 * decides when to write.
 *
 * The transport is injected, so the batching, retry and flush-on-exit rules
 * are tested without a network.
 */

export type ReaderEventDelivery = {
  /**
   * True when the page is going away. The transport must then use a request
   * that outlives the document; an ordinary fetch is cancelled on `pagehide`
   * in Safari and the batch is lost.
   */
  keepalive: boolean;
};

export type ReaderEventTransport = (events: ReaderEvent[], delivery: ReaderEventDelivery) => Promise<void>;

export type ReaderEventQueueOptions = {
  transport: ReaderEventTransport;
  /** Milliseconds to wait before writing a partial batch. */
  flushDelayMs?: number;
  /** Events that trigger an immediate flush instead of waiting. */
  maxBatchSize?: number;
};

/**
 * Most events one request may carry. The database refuses more than 100 per
 * call outright, and a refused batch used to be re-queued whole - so a reader
 * who went offline long enough to queue 101 events never recorded anything
 * again for the rest of the session.
 */
export const maxEventsPerRequest = 50;

/** Most events kept for a retry while the backend is unreachable. */
const maxRetainedEvents = 200;

/**
 * Whether a failed write would fail again if retried unchanged.
 *
 * Retrying is right for a network that dropped or a server that hiccupped
 * (5xx, a rate limit). It is wrong for a request the database refused on its
 * merits - a malformed or oversized event (22xxx), an event for a boks erased
 * while it sat in the queue (23503), a session that cannot write (42501) - and
 * re-queuing those blocks every later event behind them.
 */
export function isPermanentEventFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, status, message } = error as { code?: unknown; status?: unknown; message?: unknown };
  if (typeof code === "string" && /^(22|23|42)[0-9A-Z]{3}$/.test(code)) return true;
  if (typeof status === "number") return isPermanentStatus(status);
  if (typeof message === "string") {
    const match = /\((\d{3})\)/.exec(message);
    if (match) return isPermanentStatus(Number(match[1]));
  }
  return false;
}

function isPermanentStatus(status: number) {
  return status >= 400 && status < 500 && status !== 404 && status !== 408 && status !== 429;
}

const immediateEventTypes = new Set<ReaderEventType>(["complete", "skip", "like", "comment", "share"]);

/**
 * Event types that may legitimately repeat for the same boks in the same
 * session. Everything else is recorded once per (session, boks): the feed wraps
 * around a small catalog, and counting the second lap as a second impression
 * while the outcome is recorded once would make finish rate fall mechanically
 * the longer someone reads.
 */
const repeatableEventTypes = new Set<ReaderEventType>(["heartbeat"]);

function dedupeKey(event: ReaderEvent) {
  return `${event.sessionId}:${event.storyId}:${event.eventType}`;
}

export type ReaderEventQueue = {
  /** Returns false when the event was dropped as a duplicate. */
  record: (event: ReaderEvent) => boolean;
  flush: (delivery?: ReaderEventDelivery) => Promise<void>;
  pendingCount: () => number;
  dispose: () => void;
};

export function createReaderEventQueue(options: ReaderEventQueueOptions): ReaderEventQueue {
  const flushDelayMs = options.flushDelayMs ?? 2500;
  const maxBatchSize = options.maxBatchSize ?? 20;

  let pending: ReaderEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let disposed = false;
  const recorded = new Set<string>();

  function clearTimer() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  /**
   * Sends one chunk. A chunk the database refuses on its merits is split in
   * half and retried, so one bad event costs only itself; what still fails
   * alone is dropped. A transient failure hands the chunk back for later.
   */
  async function send(chunk: ReaderEvent[], delivery: ReaderEventDelivery): Promise<ReaderEvent[]> {
    try {
      await options.transport(chunk, delivery);
      return [];
    } catch (error) {
      if (!isPermanentEventFailure(error)) return chunk;
      // A page that is going away has no time to bisect.
      if (chunk.length <= 1 || delivery.keepalive) return [];
      const middle = Math.ceil(chunk.length / 2);
      const left = await send(chunk.slice(0, middle), delivery);
      const right = await send(chunk.slice(middle), delivery);
      return [...left, ...right];
    }
  }

  async function flush(delivery: ReaderEventDelivery = { keepalive: false }): Promise<void> {
    clearTimer();
    if (inFlight) await inFlight.catch(() => undefined);
    if (!pending.length) return;

    const batch = pending;
    pending = [];

    inFlight = (async () => {
      const retry: ReaderEvent[] = [];
      for (let start = 0; start < batch.length; start += maxEventsPerRequest) {
        const chunk = batch.slice(start, start + maxEventsPerRequest);
        // Once the backend is unreachable, the rest of this flush would fail
        // the same way; keep it for the next one instead of hammering.
        if (retry.length) {
          retry.push(...chunk);
          continue;
        }
        retry.push(...(await send(chunk, delivery)));
      }
      // Keep what failed transiently for the next flush rather than losing
      // behavior data, but never let a failing backend grow it without bound.
      if (retry.length) pending = [...retry, ...pending].slice(-maxRetainedEvents);
    })().finally(() => {
      inFlight = null;
    });

    await inFlight;
  }

  function record(event: ReaderEvent) {
    if (disposed) return false;

    if (!repeatableEventTypes.has(event.eventType)) {
      const key = dedupeKey(event);
      if (recorded.has(key)) return false;
      recorded.add(key);
    }

    pending.push(event);

    if (pending.length >= maxBatchSize || immediateEventTypes.has(event.eventType)) {
      // An outcome recorded while the page is going away (the `exit` verdict on
      // `pagehide`) must ride a request that outlives the document; an ordinary
      // fetch started here is cancelled, and the queue's own exit flush then
      // finds nothing left to send.
      void flush({ keepalive: pageIsHidden() });
      return true;
    }

    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        void flush();
      }, flushDelayMs);
    }

    return true;
  }

  return {
    record,
    flush,
    pendingCount: () => pending.length,
    dispose: () => {
      disposed = true;
      clearTimer();
      void flush();
    },
  };
}

function pageIsHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * Best-effort flush when the tab goes away. `visibilitychange` is the reliable
 * signal on mobile Safari, where `beforeunload` often never fires.
 */
export function flushReaderEventsOnExit(queue: ReaderEventQueue) {
  if (typeof window === "undefined") return () => undefined;

  const onHidden = () => {
    if (document.visibilityState === "hidden") void queue.flush({ keepalive: true });
  };
  const onPageHide = () => {
    void queue.flush({ keepalive: true });
  };

  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", onPageHide);

  return () => {
    document.removeEventListener("visibilitychange", onHidden);
    window.removeEventListener("pagehide", onPageHide);
  };
}
