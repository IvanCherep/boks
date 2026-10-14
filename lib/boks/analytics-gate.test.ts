import { describe, expect, it } from "vitest";
import { analyticsAllowed } from "@/lib/boks/analytics-gate";

const env = (over: Partial<{ hostname: string; webdriver: boolean; optIn: boolean }> = {}) => ({
  hostname: "tryboks.com",
  webdriver: false,
  optIn: false,
  ...over,
});

describe("analyticsAllowed", () => {
  it("records a person on the site", () => {
    expect(analyticsAllowed(env())).toBe(true);
    expect(analyticsAllowed(env({ hostname: "www.tryboks.com" }))).toBe(true);
  });

  it("leaves out the local dev server and automated browsers", () => {
    for (const hostname of ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "mac.local", "boks.localhost"]) {
      expect(analyticsAllowed(env({ hostname }))).toBe(false);
    }
    expect(analyticsAllowed(env({ webdriver: true }))).toBe(false);
  });

  it("records a local build that asked to, and nothing without a browser", () => {
    expect(analyticsAllowed(env({ hostname: "localhost", optIn: true }))).toBe(true);
    expect(analyticsAllowed(null)).toBe(false);
  });
});
