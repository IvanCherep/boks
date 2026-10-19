import { beforeEach, describe, expect, it } from "vitest";
import {
  formatCooldown,
  magicLinkCooldownMs,
  magicLinkCooldownRemainingMs,
  recordMagicLinkSent,
} from "@/components/boks/magic-link-cooldown";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  // A minimal localStorage: the module must work through the real interface,
  // including the case where it throws.
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

describe("magic link cooldown", () => {
  it("says nothing to wait for an address never asked about", () => {
    expect(magicLinkCooldownRemainingMs("nobody@boks.test", start)).toBe(0);
  });

  it("counts down from the moment a link was sent", () => {
    recordMagicLinkSent("reader@boks.test", start);

    expect(magicLinkCooldownRemainingMs("reader@boks.test", start)).toBe(magicLinkCooldownMs);
    expect(magicLinkCooldownRemainingMs("reader@boks.test", start + 20_000)).toBe(40_000);
    expect(magicLinkCooldownRemainingMs("reader@boks.test", start + magicLinkCooldownMs)).toBe(0);
    expect(magicLinkCooldownRemainingMs("reader@boks.test", start + 999_999)).toBe(0);
  });

  it("is per address, because the server's limit is", () => {
    recordMagicLinkSent("one@boks.test", start);

    // Switching to a different email must not inherit someone else's wait.
    expect(magicLinkCooldownRemainingMs("two@boks.test", start)).toBe(0);
  });

  it("ignores case and surrounding space, as the sign-in form does", () => {
    recordMagicLinkSent("  Reader@Boks.TEST ", start);
    expect(magicLinkCooldownRemainingMs("reader@boks.test", start)).toBe(magicLinkCooldownMs);
  });

  it("survives a reload, because the server's limit does", () => {
    recordMagicLinkSent("reader@boks.test", start);
    // A reload is a fresh module reading the same storage.
    expect(magicLinkCooldownRemainingMs("reader@boks.test", start + 5_000)).toBe(55_000);
  });

  it("forgets addresses whose wait has passed rather than growing forever", () => {
    recordMagicLinkSent("old@boks.test", start);
    recordMagicLinkSent("new@boks.test", start + magicLinkCooldownMs + 1);

    const stored = JSON.parse(store.get("boks-magic-link-sent-at") ?? "{}");
    expect(Object.keys(stored)).toEqual(["new@boks.test"]);
  });

  it("keeps a second address that is still waiting", () => {
    recordMagicLinkSent("first@boks.test", start);
    recordMagicLinkSent("second@boks.test", start + 10_000);

    const stored = JSON.parse(store.get("boks-magic-link-sent-at") ?? "{}");
    expect(Object.keys(stored).sort()).toEqual(["first@boks.test", "second@boks.test"]);
  });

  it("survives storage that refuses to answer", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => {
            throw new Error("denied");
          },
          setItem: () => {
            throw new Error("denied");
          },
          removeItem: () => undefined,
        },
      },
    });

    // The wait is a courtesy; the server still enforces the real limit.
    expect(() => recordMagicLinkSent("reader@boks.test", start)).not.toThrow();
    expect(magicLinkCooldownRemainingMs("reader@boks.test", start)).toBe(0);
  });

  it("reads as a clock, not a number to interpret", () => {
    expect(formatCooldown(61)).toBe("1:01");
    expect(formatCooldown(60)).toBe("1:00");
    expect(formatCooldown(9)).toBe("0:09");
    expect(formatCooldown(0)).toBe("0:00");
    expect(formatCooldown(-5)).toBe("0:00");
  });
});
