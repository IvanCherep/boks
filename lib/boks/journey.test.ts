import { describe, expect, it } from "vitest";
import { journeyAttribution, signupReason } from "@/lib/boks/journey";

describe("where a visit came from", () => {
  it("names a bok shared in Telegram, which the /b page passes on because its redirect loses the referrer", () => {
    const visit = journeyAttribution("https://tryboks.com/?bok=a1e3baf7-44da-4867-a817-088f1cdfbd26&from=share&ref=t.me", "");
    expect(visit).toEqual({
      landing: "shared_bok",
      landingBokId: "a1e3baf7-44da-4867-a817-088f1cdfbd26",
      linkCode: null,
      referrerHost: "t.me",
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
    });
  });

  it("keeps the campaign a link was posted with", () => {
    const visit = journeyAttribution(
      "https://tryboks.com/?utm_source=telegram&utm_medium=channel&utm_campaign=launch",
      "https://t.me/"
    );
    expect(visit.landing).toBe("home");
    expect(visit.utmSource).toBe("telegram");
    expect(visit.utmCampaign).toBe("launch");
    expect(visit.referrerHost).toBe("t.me");
  });

  it("does not call boks its own source", () => {
    // Moving from /b to the reader is navigation, not an arrival from anywhere.
    expect(journeyAttribution("https://tryboks.com/?bok=x", "https://tryboks.com/b/x").referrerHost).toBeNull();
    expect(journeyAttribution("https://tryboks.com/", "https://www.tryboks.com/").referrerHost).toBeNull();
  });

  it("calls a visit with no referrer direct", () => {
    expect(journeyAttribution("https://tryboks.com/", "")).toEqual({
      landing: "home",
      landingBokId: null,
      linkCode: null,
      referrerHost: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
    });
  });

  it("names the bok and the tracked link a university link opened", () => {
    // `/b/<id>?link=msu-philology` after the /b page's redirect.
    const visit = journeyAttribution(
      "https://tryboks.com/?bok=A1E3BAF7-44DA-4867-A817-088F1CDFBD26&from=share&link=MSU-Philology",
      ""
    );
    expect(visit.landing).toBe("shared_bok");
    expect(visit.landingBokId).toBe("a1e3baf7-44da-4867-a817-088f1cdfbd26");
    expect(visit.linkCode).toBe("msu-philology");
  });

  it("keeps a tracked link to a page, and knows the series shelf from the feed", () => {
    expect(journeyAttribution("https://tryboks.com/?link=spbu", "").linkCode).toBe("spbu");
    expect(journeyAttribution("https://tryboks.com/series?link=spbu", "").landing).toBe("series");
    expect(journeyAttribution("https://tryboks.com/series/", "").landing).toBe("series");
  });

  it("drops a code or a bok id that cannot be one, rather than sending noise", () => {
    const visit = journeyAttribution("https://tryboks.com/?bok=a1e3baf7-damaged&link=<script>", "");
    expect(visit.landingBokId).toBeNull();
    expect(visit.linkCode).toBeNull();
    // Still a shared-bok visit: the reader came through a link, it was just damaged.
    expect(visit.landing).toBe("shared_bok");
  });

  it("survives an address it cannot parse", () => {
    expect(() => journeyAttribution("not a url", "also not")).not.toThrow();
  });
});

describe("why a guest met the sign-up", () => {
  it("tells the limit from a gated action from the reader's own choice", () => {
    expect(signupReason({ reason: "required" })).toBe("limit");
    expect(signupReason({ reason: "manual", intent: "like" })).toBe("like");
    expect(signupReason({ reason: "manual", intent: "comment" })).toBe("comment");
    expect(signupReason({ reason: "manual", intent: "follow" })).toBe("follow");
    expect(signupReason({ reason: "notice" })).toBe("notice");
    expect(signupReason({ reason: "manual", intent: "general" })).toBe("manual");
  });

  it("has nothing to say about signing in versus signing up", () => {
    // There is one way in now - an address, and an account if there is not
    // one - so a reader's own tap on the account button is "manual" whether or
    // not they already have an account.
    expect(signupReason({ reason: "manual" })).toBe("manual");
  });

  it("puts the limit first, because it is the wall that ends a guest's reading", () => {
    expect(signupReason({ reason: "required", intent: "like" })).toBe("limit");
  });
});
