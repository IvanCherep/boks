import { beforeEach, describe, expect, it } from "vitest";
import { clearPendingEmailCode, dismissPendingEmailCode, pendingEmailCodeMs, readPendingEmailCode, savePendingEmailCode } from "@/components/boks/pending-email-code";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    },
  });
});

const start = 1_800_000_000_000;
const sent = { email: "reader@boks.test", surface: "reader" as const, reason: "manual" as const, intent: "follow" as const };

describe("a sent code across a reload", () => {
  it("comes back on the surface it was asked from, and only there", () => {
    savePendingEmailCode(sent, start);
    expect(readPendingEmailCode("reader", start + 60_000)).toEqual({ ...sent, sentAt: start, dismissed: false });
    expect(readPendingEmailCode("author", start + 60_000)).toBeNull();
  });

  it("is forgotten once the code is too old to work", () => {
    savePendingEmailCode(sent, start);
    expect(readPendingEmailCode("reader", start + pendingEmailCodeMs)).toBeNull();
    expect(store.size).toBe(0);
  });

  it("stays after a close, marked so the page does not open it by itself", () => {
    savePendingEmailCode(sent, start);
    dismissPendingEmailCode();
    expect(readPendingEmailCode("reader", start + 1000)?.dismissed).toBe(true);
    // A new code is a new request: it may open the panel again.
    savePendingEmailCode(sent, start + 2000);
    expect(readPendingEmailCode("reader", start + 3000)?.dismissed).toBe(false);
  });

  it("goes when used or replaced, and survives storage that throws", () => {
    savePendingEmailCode(sent, start);
    clearPendingEmailCode();
    expect(readPendingEmailCode("reader", start)).toBeNull();
    store.set("boks-pending-email-code", "{not json");
    expect(readPendingEmailCode("reader", start)).toBeNull();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { get localStorage(): Storage { throw new Error("denied"); } } });
    expect(() => savePendingEmailCode(sent, start)).not.toThrow();
    expect(readPendingEmailCode("reader", start)).toBeNull();
  });
});
