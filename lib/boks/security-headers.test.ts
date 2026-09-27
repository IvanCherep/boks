import { describe, expect, it } from "vitest";
import { applySecurityHeaders, contentSecurityPolicy } from "@/lib/boks/security-headers";

describe("security headers", () => {
  it("restricts executable and framing sources while allowing Supabase connections", () => {
    const policy = contentSecurityPolicy("https://project.supabase.co");
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("connect-src 'self' https://project.supabase.co wss://project.supabase.co");
  });

  it("adds HSTS only to HTTPS responses", () => {
    const secure = applySecurityHeaders(new Response(), new URL("https://tryboks.com"));
    expect(secure.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(secure.headers.get("x-content-type-options")).toBe("nosniff");
    expect(secure.headers.get("x-frame-options")).toBe("DENY");

    const local = applySecurityHeaders(new Response(), new URL("http://localhost:5173"));
    expect(local.headers.has("strict-transport-security")).toBe(false);
  });
});
