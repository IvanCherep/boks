import { afterEach, describe, expect, it } from "vitest";
import { randomBoksId } from "@/lib/boks/browser-id";

const realCrypto = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", { value: realCrypto, configurable: true, writable: true });
});

function withCrypto(value: unknown) {
  Object.defineProperty(globalThis, "crypto", { value, configurable: true, writable: true });
}

describe("making an id in a browser that may not have crypto.randomUUID", () => {
  it("uses randomUUID when it is there", () => {
    withCrypto({ randomUUID: () => "11111111-2222-4333-8444-555555555555" });
    expect(randomBoksId()).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("falls back when the method is missing - an insecure context, or an old Chromium", () => {
    withCrypto({ getRandomValues: (bytes: Uint8Array) => bytes.fill(7) });
    expect(randomBoksId()).toBe("07".repeat(16));
  });

  it("falls back when the method exists and throws, which some in-app browsers do", () => {
    withCrypto({
      randomUUID: () => {
        throw new Error("not available in this context");
      },
      getRandomValues: (bytes: Uint8Array) => bytes.fill(255),
    });
    expect(randomBoksId()).toBe("ff".repeat(16));
  });

  it("still returns something when there is no crypto at all, because the reader must open", () => {
    withCrypto(undefined);
    const first = randomBoksId();
    const second = randomBoksId();
    expect(first).toMatch(/^r[0-9a-z]+$/);
    expect(first).not.toBe(second);
  });

  it("never throws, whatever the browser does", () => {
    withCrypto({
      randomUUID: () => {
        throw new Error("no");
      },
      getRandomValues: () => {
        throw new Error("also no");
      },
    });
    expect(() => randomBoksId()).not.toThrow();
  });
});
