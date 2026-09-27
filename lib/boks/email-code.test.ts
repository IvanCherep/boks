import { describe, expect, it } from "vitest";
import { boksEmailCodeLength, normalizeBoksEmailCode } from "@/lib/boks/supabase-client";

describe("the code from the sign-in email", () => {
  it("keeps the digits and nothing else", () => {
    // How a code actually arrives: pasted with the space the email put in it,
    // with the full stop that ended the sentence, or typed with a dash by
    // somebody reading it back to themselves. None of those is a wrong code.
    expect(normalizeBoksEmailCode("123 456")).toBe("123456");
    expect(normalizeBoksEmailCode(" 123-456. ")).toBe("123456");
    expect(normalizeBoksEmailCode("123456")).toBe("123456");
  });

  it("stops at the length of a code, so a pasted paragraph cannot be sent", () => {
    expect(normalizeBoksEmailCode("1234567890")).toHaveLength(boksEmailCodeLength);
    expect(normalizeBoksEmailCode("code: 654321, valid for 1 hour")).toBe("654321");
  });

  it("has nothing to send when there are no digits", () => {
    expect(normalizeBoksEmailCode("")).toBe("");
    expect(normalizeBoksEmailCode("no code here")).toBe("");
  });
});
