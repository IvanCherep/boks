import { describe, expect, it } from "vitest";
import {
  isPlausibleRefreshToken,
  isSameOrigin,
  isSecureRequest,
  keptSessionClearCookie,
  keptSessionSetCookie,
  readKeptSession,
} from "./session-keeper";

describe("keeping a reader signed in", () => {
  it("keeps the refresh token where the page cannot read it, for half a year, for the session routes only", () => {
    const cookie = keptSessionSetCookie("abcDEF123_-xyz", true);
    expect(cookie).toContain("boks_session=abcDEF123_-xyz");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/api/session");
    expect(cookie).toContain(`Max-Age=${180 * 24 * 60 * 60}`);
    expect(keptSessionSetCookie("abcDEF123", false)).not.toContain("Secure");
    expect(keptSessionClearCookie(true)).toContain("Max-Age=0");
  });

  it("reads only a plausible token back", () => {
    expect(readKeptSession("a=1; boks_session=tok_en-123ABC; b=2")).toBe("tok_en-123ABC");
    expect(readKeptSession("boks_session=bad token!")).toBeNull();
    expect(readKeptSession(null)).toBeNull();
    expect(isPlausibleRefreshToken("x".repeat(300))).toBe(false);
  });

  it("answers the site itself only", () => {
    const from = (origin: string | null, host = "tryboks.com") =>
      new Request("http://app:3000/api/session", { method: "POST", headers: { host, ...(origin ? { origin } : {}) } });
    expect(isSameOrigin(from("https://tryboks.com"))).toBe(true);
    expect(isSameOrigin(from(null))).toBe(true);
    expect(isSameOrigin(from("https://evil.example"))).toBe(false);
  });

  it("marks the cookie Secure behind https, not on a local dev server", () => {
    expect(isSecureRequest(new Request("http://app:3000/x", { headers: { "x-forwarded-proto": "https" } }))).toBe(true);
    expect(isSecureRequest(new Request("http://localhost:5173/x"))).toBe(false);
  });
});
