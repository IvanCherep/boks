import { describe, expect, it } from "vitest";
import { applySecurityHeaders, contentSecurityPolicy } from "@/lib/boks/security-headers";

describe("security headers", () => {
  it("restricts executable and framing sources while allowing Supabase connections", () => {
    const policy = contentSecurityPolicy("https://project.supabase.co");
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain(
      "connect-src 'self' https://project.supabase.co wss://project.supabase.co https://cloudflareinsights.com"
    );
  });

  it("lets Cloudflare's analytics beacon load and report", () => {
    // Cloudflare injects the beacon at the edge, so leaving it out of the
    // policy does not remove the script - it blocks it, and the analytics go
    // quiet without anything failing loudly.
    const policy = contentSecurityPolicy("https://project.supabase.co");
    expect(policy).toContain("script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com");
    expect(policy).toContain("https://cloudflareinsights.com");
  });

  it("lets the formats play a recording from an in-memory copy", () => {
    // Seeking needs the copy: the asset server ignores range requests. Under
    // `default-src 'self'` alone a blob: recording is refused and nothing plays.
    expect(contentSecurityPolicy()).toContain("media-src 'self' blob:");
  });

  it("adds HSTS only to HTTPS responses", () => {
    const secure = applySecurityHeaders(new Response(), new URL("https://tryboks.com"));
    expect(secure.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(secure.headers.get("x-content-type-options")).toBe("nosniff");
    expect(secure.headers.get("x-frame-options")).toBe("DENY");

    const local = applySecurityHeaders(new Response(), new URL("http://localhost:5173"));
    expect(local.headers.has("strict-transport-security")).toBe(false);
  });

  it("lets Studio frame the author-page preview, and nothing else", () => {
    // Studio shows `/author/preview` in a frame at desktop and phone width.
    // Only boks itself may frame it; every other page still refuses frames.
    const preview = applySecurityHeaders(new Response(), new URL("https://tryboks.com/author/preview?space=1"));
    expect(preview.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    expect(preview.headers.get("content-security-policy")).not.toContain("frame-ancestors 'none'");
    expect(preview.headers.get("x-frame-options")).toBe("SAMEORIGIN");

    for (const path of ["/", "/admin", "/author", "/author/previewer", "/@pushkin"]) {
      const other = applySecurityHeaders(new Response(), new URL(`https://tryboks.com${path}`));
      expect(other.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(other.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  it("upgrades insecure requests everywhere but a local development server", () => {
    // Safari upgrades localhost too, and a dev server has no https to upgrade to.
    const live = applySecurityHeaders(new Response(), new URL("https://tryboks.com/"));
    expect(live.headers.get("content-security-policy")).toContain("upgrade-insecure-requests");
    for (const origin of ["http://localhost:5173/", "http://127.0.0.1:5174/"]) {
      const local = applySecurityHeaders(new Response(), new URL(origin));
      expect(local.headers.get("content-security-policy")).not.toContain("upgrade-insecure-requests");
    }
  });
});
