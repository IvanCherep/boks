import { describe, expect, it } from "vitest";
import { readOnboardingRecord, shouldInviteToOnboarding, shouldOpenOnboarding } from "./eligibility";

describe("shouldOpenOnboarding", () => {
  it("never opens by itself", () => {
    expect(shouldOpenOnboarding("")).toBe(false);
    expect(shouldOpenOnboarding("?bok=abc")).toBe(false);
  });
  it("opens on ?welcome=1", () => {
    expect(shouldOpenOnboarding("?welcome=1")).toBe(true);
    expect(shouldOpenOnboarding("?lang=en&welcome=1")).toBe(true);
  });
});

describe("shouldInviteToOnboarding", () => {
  it("invites a guest who has not met it yet", () => {
    expect(shouldInviteToOnboarding({ signedIn: false, record: null })).toBe(true);
  });
  it("leaves accounts and guests who finished or skipped it alone", () => {
    expect(shouldInviteToOnboarding({ signedIn: true, record: null })).toBe(false);
    expect(shouldInviteToOnboarding({ signedIn: false, record: { status: "skipped", at: 1 } })).toBe(false);
    expect(shouldInviteToOnboarding({ signedIn: false, record: { status: "completed", at: 1 } })).toBe(false);
  });
});

describe("readOnboardingRecord", () => {
  it("ignores missing or malformed records", () => {
    expect(readOnboardingRecord(null)).toBeNull();
    expect(readOnboardingRecord({ getItem: () => "{oops" })).toBeNull();
    expect(readOnboardingRecord({ getItem: () => JSON.stringify({ status: "other" }) })).toBeNull();
    expect(readOnboardingRecord({ getItem: () => JSON.stringify({ status: "completed", at: 5 }) })?.status).toBe("completed");
  });
});
