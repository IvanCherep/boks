import { describe, expect, it } from "vitest";
import type { GuestDayBok, GuestDayDevice } from "@/components/boks/client-types";
import { bokSummary, dayCountries, deviceOutcome, duration, visitSummary } from "@/components/boks/admin/guest-day-format";

const bok = (over: Partial<GuestDayBok> = {}): GuestDayBok => ({
  title: "Invictus",
  at: "2026-10-14T08:00:00Z",
  seconds: 14,
  touch: null,
  finished: false,
  leftBy: null,
  liked: false,
  shared: false,
  ...over,
});

const device = (boks: GuestDayBok[]): GuestDayDevice => ({
  device: "abc123",
  country: "RS",
  guest: true,
  account: false,
  returning: false,
  firstAt: "2026-10-14T08:00:00Z",
  lastAt: "2026-10-14T08:01:00Z",
  visits: [],
  prompts: [],
  requested: false,
  boks,
});

describe("duration", () => {
  it("reads as seconds under a minute and minutes after", () => {
    expect(duration(4.4)).toBe("4 s");
    expect(duration(125)).toBe("2 min 5 s");
    expect(duration(120)).toBe("2 min");
    expect(duration(null)).toBe("0 s");
  });
});

describe("bokSummary", () => {
  it("says when nobody touched a bok", () => {
    expect(bokSummary(bok({ seconds: 3 }))).toBe("3 s · no touch");
    expect(bokSummary(bok({ seconds: 3, leftBy: "exit" }))).toBe("3 s · no touch · closed the page");
  });

  it("names the touch and how the bok ended", () => {
    expect(bokSummary(bok({ touch: "tap", leftBy: "swipe" }))).toBe("14 s · tapped · swiped on");
    expect(bokSummary(bok({ touch: "scroll", finished: true, liked: true }))).toBe("14 s · scrolled · finished · liked");
  });

  it("does not call a swipe away untouched", () => {
    expect(bokSummary(bok({ leftBy: "swipe" }))).toBe("14 s · swiped on");
  });
});

describe("deviceOutcome", () => {
  it("is the furthest the device got", () => {
    expect(deviceOutcome(device([]))).toBe("nothing");
    expect(deviceOutcome(device([bok(), bok({ leftBy: "exit" })]))).toBe("looked");
    expect(deviceOutcome(device([bok(), bok({ leftBy: "button" })]))).toBe("touched");
    expect(deviceOutcome(device([bok({ touch: "tap" }), bok({ finished: true })]))).toBe("finished");
  });
});

describe("visitSummary and dayCountries", () => {
  it("describes an arrival", () => {
    expect(
      visitSummary({ at: "", landing: "shared_bok", referrer: "t.me", campaign: null, link: "Post", bok: "Invictus" })
    ).toBe("shared bok “Invictus” · via t.me · link “Post”");
    expect(visitSummary({ at: "", landing: "home", referrer: null, campaign: null, link: null, bok: null })).toBe(
      "home page · direct"
    );
  });

  it("calls a device with no country what it is", () => {
    expect(dayCountries([{ country: "none", devices: 12 }, { country: "RS", devices: 3 }])).toBe("no country 12 · 🇷🇸 RS 3");
  });
});
