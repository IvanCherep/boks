import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPoemManifest } from "./poems";

describe("poem manifest loading", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("aborts a stalled request after twelve seconds so retry remains reachable", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const request = expect(loadPoemManifest("/poetry/manifest.json")).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(12_000);
    await request;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the deadline after success and preserves the manifest", async () => {
    vi.useFakeTimers();
    const manifest = { title: "Actual poem", durationMs: 42_000 };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => manifest })));
    await expect(loadPoemManifest("/poetry/manifest.json")).resolves.toEqual(manifest);
    expect(vi.getTimerCount()).toBe(0);
  });
});
