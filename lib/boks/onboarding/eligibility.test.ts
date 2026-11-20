import { describe, expect, it } from "vitest";
import { readOnboardingRecord, shouldOfferOnboarding } from "./eligibility";

const newGuest = { pathname: "/", search: "", signedIn: false, record: null, guestReads: 0, welcomeSeen: false };

describe("shouldOfferOnboarding", () => {
  it("meets a new guest who opened boks itself", () => {
    expect(shouldOfferOnboarding(newGuest)).toBe(true);
  });
  it("leaves shared links, author pages, accounts and returning guests alone", () => {
    expect(shouldOfferOnboarding({ ...newGuest, search: "?bok=abc" })).toBe(false);
    expect(shouldOfferOnboarding({ ...newGuest, search: "?author=x" })).toBe(false);
    expect(shouldOfferOnboarding({ ...newGuest, pathname: "/a/prokhorov" })).toBe(false);
    expect(shouldOfferOnboarding({ ...newGuest, signedIn: true })).toBe(false);
    expect(shouldOfferOnboarding({ ...newGuest, guestReads: 2 })).toBe(false);
    expect(shouldOfferOnboarding({ ...newGuest, welcomeSeen: true })).toBe(false);
    expect(shouldOfferOnboarding({ ...newGuest, record: { status: "skipped", at: 1 } })).toBe(false);
  });
  it("replays on ?welcome=1 for anyone", () => {
    expect(shouldOfferOnboarding({ ...newGuest, search: "?welcome=1", signedIn: true, record: { status: "completed", at: 1 } })).toBe(true);
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
