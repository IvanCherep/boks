import { describe, expect, it } from "vitest";
import { describeMagicLinkRedirectError } from "@/lib/boks/magic-link-errors";

describe("describeMagicLinkRedirectError", () => {
  it("explains a link opened in another browser instead of showing the PKCE error", () => {
    const text = describeMagicLinkRedirectError(
      "PKCE code verifier not found in storage. This can happen if the auth flow was initiated in a different browser or device, or if the storage was cleared. For SSR frameworks (Next.js, SvelteKit, etc.), use @supabase/ssr on both the server and client to store the code verifier in cookies."
    );
    expect(text).toMatch(/different browser or app/);
    expect(text).not.toMatch(/PKCE|SSR|verifier/);
  });

  it("explains an expired or used link, including the URL-encoded form Supabase redirects with", () => {
    expect(describeMagicLinkRedirectError("Email+link+is+invalid+or+has+expired")).toMatch(/expired or was already used/);
    expect(describeMagicLinkRedirectError("otp_expired")).toMatch(/expired or was already used/);
  });

  it("never passes an unknown error through", () => {
    expect(describeMagicLinkRedirectError("something odd happened: 500")).toBe(
      "That sign-in link did not work. Request a new one and open it in this browser."
    );
    expect(describeMagicLinkRedirectError(null)).toMatch(/did not work/);
  });
});

describe("describeMagicLinkRedirectError in Russian", () => {
  it("says the same things in Russian", () => {
    expect(describeMagicLinkRedirectError("PKCE code verifier not found", "ru")).toMatch(/не в том браузере/);
    expect(describeMagicLinkRedirectError("otp_expired", "ru")).toMatch(/устарела или уже использована/);
    expect(describeMagicLinkRedirectError("odd", "ru")).toMatch(/не сработала/);
  });
});
