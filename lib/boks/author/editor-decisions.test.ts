import { describe, expect, it } from "vitest";
import { changeAction, decisionReady, isDecisionKind, takeAfterNote } from "@/lib/boks/author/editor-decisions";

describe("the editors' reasoned answer", () => {
  it("sends the author to the right place for each kind of request", () => {
    expect(changeAction("recording")).toBe("voice");
    expect(changeAction("text")).toBe("text");
    expect(changeAction("law")).toBe("edit");
    expect(changeAction("other")).toBe("edit");
  });

  it("needs a kind and a note the author can read", () => {
    expect(decisionReady(null, "Шум в записи")).toBe(false);
    expect(decisionReady("recording", " ")).toBe(false);
    expect(decisionReady("recording", "Шум в записи")).toBe(true);
    expect(decisionReady("text", "я".repeat(2001))).toBe(false);
    expect(isDecisionKind("law")).toBe(true);
    expect(isDecisionKind("mood")).toBe(false);
  });

  it("counts only a take made after a note asking for a new recording", () => {
    expect(takeAfterNote("2026-11-22T10:00:00Z", "2026-11-22T11:00:00Z")).toBe(false);
    expect(takeAfterNote("2026-11-22T12:00:00Z", "2026-11-22T11:00:00Z")).toBe(true);
    expect(takeAfterNote("2026-11-22T10:00:00Z", null)).toBe(true);
  });
});
