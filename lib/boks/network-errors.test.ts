import { describe, expect, it, vi } from "vitest";
import {
  bootTimeoutMs,
  isUnreachableBoksError,
  unreachableMarker,
  withUnreachableTimeout,
} from "@/lib/boks/network-errors";

describe("telling an unreachable server from any other failure", () => {
  it("recognises what browsers actually say when a host cannot be reached", () => {
    // One per engine, because none of them agrees on the wording and none is
    // going to start.
    for (const message of [
      "TypeError: Failed to fetch",
      "Load failed",
      "NetworkError when attempting to fetch resource.",
      "net::ERR_CONNECTION_RESET",
      "net::ERR_TIMED_OUT",
      "FetchError: fetch failed",
    ]) {
      expect(isUnreachableBoksError(new Error(message)), message).toBe(true);
    }
  });

  it("recognises a call this app gave up on", () => {
    expect(isUnreachableBoksError(new Error(`${unreachableMarker}: the boks session did not answer`))).toBe(true);
  });

  it("looks inside the cause, which is where fetch hides the reason", () => {
    const error = new Error("Request failed", { cause: new Error("Failed to fetch") });
    expect(isUnreachableBoksError(error)).toBe(true);
  });

  it("does not claim a network problem for an ordinary error", () => {
    for (const message of [
      "Sign in required to submit a bok.",
      "This boks account is suspended.",
      "invalid claim: missing sub claim",
      "That bok is no longer open.",
    ]) {
      expect(isUnreachableBoksError(new Error(message)), message).toBe(false);
    }
    expect(isUnreachableBoksError(null)).toBe(false);
    expect(isUnreachableBoksError({})).toBe(false);
  });
});

describe("the boot deadline", () => {
  it("passes a call that answers in time straight through", async () => {
    await expect(withUnreachableTimeout(Promise.resolve("session"), "the boks session")).resolves.toBe("session");
  });

  it("gives up after the deadline, with a reason the reader screen can read", async () => {
    vi.useFakeTimers();
    try {
      const pending = withUnreachableTimeout(new Promise(() => {}), "the boks session", 8000);
      const asserted = expect(pending).rejects.toThrow(unreachableMarker);
      await vi.advanceTimersByTimeAsync(8000);
      await asserted;
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears its timer when the call wins, so a phone is not kept awake", async () => {
    vi.useFakeTimers();
    try {
      await withUnreachableTimeout(Promise.resolve("ok"), "the boks session", 8000);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits eight seconds by default: a slow phone finishes, a blocked host does not", () => {
    expect(bootTimeoutMs).toBe(8000);
  });
});
