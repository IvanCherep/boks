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
 * The transport is injected, so the Supabase reader and the D1 compatibility
 * reader share this batching, retry and flush-on-exit behavior.
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

  async function flush(delivery: ReaderEventDelivery = { keepalive: false }): Promise<void> {
    clearTimer();
    if (inFlight) await inFlight.catch(() => undefined);
    if (!pending.length) return;

    const batch = pending;
    pending = [];

    inFlight = options
      .transport(batch, delivery)
      .catch(() => {
        // Keep the batch for the next flush rather than losing behavior data,
        // but never let a failing backend grow the queue without bound.
        pending = [...batch, ...pending].slice(-200);
      })
      .finally(() => {
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
      void flush();
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
