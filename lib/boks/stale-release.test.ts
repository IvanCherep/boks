import { describe, expect, it } from "vitest";
import { staleReleaseBootScript, staleReleaseReloadKey } from "@/lib/boks/stale-release";

function tab(now: number, stored: Record<string, string> = {}) {
  const listeners: Record<string, (event: { preventDefault(): void }) => void> = {};
  const store = new Map(Object.entries(stored));
  let reloads = 0;
  const window = {
    addEventListener: (name: string, fn: (event: { preventDefault(): void }) => void) => { listeners[name] = fn; },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    location: { reload: () => { reloads += 1; } },
  };
  new Function("window", "Date", staleReleaseBootScript)(window, { now: () => now });
  const fire = () => {
    let prevented = false;
    listeners["vite:preloadError"]({ preventDefault: () => { prevented = true; } });
    return prevented;
  };
  return { fire, reloads: () => reloads, store };
}

describe("a tab left open across a release", () => {
  it("reloads to the current release when a script it asks for is gone", () => {
    const t = tab(1_000_000);
    expect(t.fire()).toBe(true);
    expect(t.reloads()).toBe(1);
    expect(t.store.get(staleReleaseReloadKey)).toBe("1000000");
  });

  it("does not reload again within a minute, so a real failure cannot loop", () => {
    const t = tab(1_030_000, { [staleReleaseReloadKey]: "1000000" });
    expect(t.fire()).toBe(false);
    expect(t.reloads()).toBe(0);
  });

  it("tries again once the minute has passed", () => {
    const t = tab(1_061_000, { [staleReleaseReloadKey]: "1000000" });
    expect(t.fire()).toBe(true);
    expect(t.reloads()).toBe(1);
  });
});
