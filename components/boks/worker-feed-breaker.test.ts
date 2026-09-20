import { describe, expect, it } from "vitest";
import {
  markWorkerFeedHealthy,
  markWorkerFeedUnavailable,
  shouldTryWorkerFeed,
  workerFeedCooldownMs,
} from "@/components/boks/worker-feed-breaker";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("worker feed breaker", () => {
  const now = 1_000_000;

  it("asks the Worker when it has not failed", () => {
    expect(shouldTryWorkerFeed(now, memoryStorage())).toBe(true);
  });

  it("skips the Worker for the cooldown after a failure, then tries again", () => {
    const storage = memoryStorage();
    markWorkerFeedUnavailable(now, storage);
    expect(shouldTryWorkerFeed(now + 1, storage)).toBe(false);
    expect(shouldTryWorkerFeed(now + workerFeedCooldownMs - 1, storage)).toBe(false);
    expect(shouldTryWorkerFeed(now + workerFeedCooldownMs, storage)).toBe(true);
  });

  it("closes as soon as the Worker serves again", () => {
    const storage = memoryStorage();
    markWorkerFeedUnavailable(now, storage);
    markWorkerFeedHealthy(storage);
    expect(shouldTryWorkerFeed(now + 1, storage)).toBe(true);
  });

  it("never blocks the Worker when storage is unavailable or broken", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => markWorkerFeedUnavailable(now, broken)).not.toThrow();
    expect(shouldTryWorkerFeed(now, broken)).toBe(true);
    expect(shouldTryWorkerFeed(now, null)).toBe(true);
  });
});
