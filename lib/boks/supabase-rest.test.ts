import { describe, expect, it } from "vitest";
import { readerIdFromAccessToken } from "@/lib/boks/supabase-rest";

function tokenWithSubject(subject: unknown) {
  const payload = btoa(JSON.stringify({ sub: subject })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `header.${payload}.signature`;
}

describe("readerIdFromAccessToken", () => {
  it("returns only a UUID subject", () => {
    expect(readerIdFromAccessToken(tokenWithSubject("11111111-1111-4111-8111-111111111111"))).toBe(
      "11111111-1111-4111-8111-111111111111"
    );
    expect(readerIdFromAccessToken(tokenWithSubject("not-a-user"))).toBeNull();
  });

  it("rejects malformed and oversized tokens", () => {
    expect(readerIdFromAccessToken("not-a-jwt")).toBeNull();
    expect(readerIdFromAccessToken("x".repeat(16_385))).toBeNull();
  });
});
