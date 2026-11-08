import { describe, expect, it } from "vitest";
import { legacyAuthStorageKey, readAuthItem } from "@/lib/boks/supabase-client";

function memory(initial: Record<string, string>) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("a session stored before the move to our own server", () => {
  it("is picked up under the new name, once", () => {
    const s = memory({ [legacyAuthStorageKey]: "old-session" });
    expect(readAuthItem(s, "sb-tryboks-auth-token")).toBe("old-session");
    expect(s.m.get("sb-tryboks-auth-token")).toBe("old-session");
    expect(s.m.has(legacyAuthStorageKey)).toBe(false);
  });

  it("never replaces a session the reader already has", () => {
    const s = memory({ [legacyAuthStorageKey]: "old-session", "sb-tryboks-auth-token": "current" });
    expect(readAuthItem(s, "sb-tryboks-auth-token")).toBe("current");
    expect(s.m.get(legacyAuthStorageKey)).toBe("old-session");
  });

  it("is not handed out for anything but the session itself", () => {
    const s = memory({ [legacyAuthStorageKey]: "old-session" });
    expect(readAuthItem(s, "sb-tryboks-auth-token-code-verifier")).toBeNull();
    expect(readAuthItem(s, "sb-tryboks-auth-token-user")).toBeNull();
  });
});
