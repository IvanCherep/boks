import { describe, expect, it, vi } from "vitest";
import { createReaderEventQueue } from "@/components/boks/reader-events";
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
});
