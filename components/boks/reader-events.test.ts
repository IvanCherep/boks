import { describe, expect, it, vi } from "vitest";
import { createReaderEventQueue, isPermanentEventFailure, maxEventsPerRequest } from "@/components/boks/reader-events";
import type { ReaderEvent, ReaderEventType } from "@/lib/boks/contracts";

function event(eventType: ReaderEventType, storyId = "story-1"): ReaderEvent {
  return {
    eventType,
    storyId,
    value: 1,
    activeSeconds: 0,
    progress: 0,
    algorithmId: "balanced",
    experimentKey: "boks-feed-v1",
    userSegment: "general",
    surface: "reader",
    rank: 0,
    clientElapsedSeconds: 0,
    sessionId: "session-1",
    visitorId: "visitor-1",
    estimatedSeconds: 240,
  };
}

describe("createReaderEventQueue", () => {
  it("batches impressions instead of sending one request each", async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const queue = createReaderEventQueue({ transport, flushDelayMs: 10_000 });

    queue.record(event("impression", "a"));
    queue.record(event("impression", "b"));
    expect(transport).not.toHaveBeenCalled();

    await queue.flush();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toHaveLength(2);
  });

  it("flushes a completion immediately, because a reader may leave next", async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const queue = createReaderEventQueue({ transport, flushDelayMs: 10_000 });

    queue.record(event("impression"));
    queue.record(event("complete"));
    await queue.flush();

    expect(transport).toHaveBeenCalled();
    expect(transport.mock.calls[0][0].map((item: ReaderEvent) => item.eventType)).toEqual(["impression", "complete"]);
  });

  it("flushes once the batch is full", async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const queue = createReaderEventQueue({ transport, flushDelayMs: 10_000, maxBatchSize: 3 });

    queue.record(event("impression", "a"));
    queue.record(event("impression", "b"));
    queue.record(event("impression", "c"));
    await queue.flush();

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toHaveLength(3);
  });

  it("keeps events for a retry when the backend fails", async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const queue = createReaderEventQueue({ transport, flushDelayMs: 10_000 });

    queue.record(event("impression"));
    await queue.flush();
    expect(queue.pendingCount()).toBe(1);

    await queue.flush();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(queue.pendingCount()).toBe(0);
  });

  it("records one impression per boks per session, so a wrapped feed cannot inflate rates", async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const queue = createReaderEventQueue({ transport, flushDelayMs: 10_000 });

    expect(queue.record(event("impression", "a"))).toBe(true);
    expect(queue.record(event("impression", "a"))).toBe(false);
    expect(queue.record(event("impression", "b"))).toBe(true);
    await queue.flush();

    expect(transport.mock.calls[0][0]).toHaveLength(2);
  });

  it("keeps starts and outcomes on the same footing", async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const queue = createReaderEventQueue({ transport, flushDelayMs: 10_000 });

    // Two laps of a one-boks catalog.
    for (let lap = 0; lap < 2; lap += 1) {
      queue.record(event("impression", "a"));
      queue.record(event("start", "a"));
      queue.record(event("complete", "a"));
    }
    await queue.flush();

    const sent = transport.mock.calls.flatMap((call) => call[0] as ReaderEvent[]);
    const counts = sent.reduce<Record<string, number>>((totals, item) => {
      totals[item.eventType] = (totals[item.eventType] ?? 0) + 1;
      return totals;
    }, {});

    expect(counts).toEqual({ impression: 1, start: 1, complete: 1 });
  });

  it("stops accepting events after dispose", async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const queue = createReaderEventQueue({ transport, flushDelayMs: 10_000 });

    queue.dispose();
    queue.record(event("impression"));
    await queue.flush();

    expect(transport).not.toHaveBeenCalled();
  });

  it("never sends more events in one request than the database accepts", async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const queue = createReaderEventQueue({ transport, flushDelayMs: 10_000, maxBatchSize: 1000 });

    for (let index = 0; index < 120; index += 1) queue.record(event("impression", `story-${index}`));
    await queue.flush();

    const sizes = transport.mock.calls.map((call) => (call[0] as ReaderEvent[]).length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(maxEventsPerRequest);
    expect(sizes.reduce((total, size) => total + size, 0)).toBe(120);
    expect(queue.pendingCount()).toBe(0);
  });

  it("drops only the event the database refuses, not the whole batch", async () => {
    const delivered: string[] = [];
    const transport = vi.fn(async (events: ReaderEvent[]) => {
      if (events.some((item) => item.storyId === "erased")) {
        throw { code: "23503", message: "violates foreign key constraint" };
      }
      delivered.push(...events.map((item) => item.storyId));
    });
    const queue = createReaderEventQueue({ transport, flushDelayMs: 10_000 });

    queue.record(event("impression", "a"));
    queue.record(event("impression", "erased"));
    queue.record(event("impression", "b"));
    queue.record(event("impression", "c"));
    await queue.flush();

    expect(delivered.sort()).toEqual(["a", "b", "c"]);
    expect(queue.pendingCount()).toBe(0);

    // A refused event is gone, so it cannot block the next flush.
    queue.record(event("impression", "d"));
    await queue.flush();
    expect(delivered).toContain("d");
  });

  it("keeps a batch for retry only when the failure is transient", async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error("Could not record reader events (503)."))
      .mockResolvedValue(undefined);
    const queue = createReaderEventQueue({ transport, flushDelayMs: 10_000 });

    queue.record(event("impression"));
    await queue.flush();
    expect(queue.pendingCount()).toBe(1);
  });
});

describe("isPermanentEventFailure", () => {
  it("treats a refusal on the merits as permanent", () => {
    expect(isPermanentEventFailure({ code: "22023" })).toBe(true);
    expect(isPermanentEventFailure({ code: "23503" })).toBe(true);
    expect(isPermanentEventFailure({ code: "42501" })).toBe(true);
    expect(isPermanentEventFailure(new Error("Could not record reader events (400)."))).toBe(true);
  });

  it("treats network, server and rate-limit failures as worth retrying", () => {
    expect(isPermanentEventFailure(new TypeError("Failed to fetch"))).toBe(false);
    expect(isPermanentEventFailure(new Error("Could not record reader events (503)."))).toBe(false);
    expect(isPermanentEventFailure({ status: 429 })).toBe(false);
    expect(isPermanentEventFailure({ code: "54023" })).toBe(false);
    expect(isPermanentEventFailure(null)).toBe(false);
  });
});
