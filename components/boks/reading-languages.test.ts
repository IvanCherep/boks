import { describe, expect, it } from "vitest";
import {
  describeEmptyLanguageFeed,
  effectiveReadingLanguages,
  emptyFeedNotice,
  normalizeReadingLanguages,
  readingLanguageChangeKeepsFeed,
} from "@/components/boks/reading-languages";

describe("normalizeReadingLanguages", () => {
  it("reduces a region tag to its language", () => {
    expect(normalizeReadingLanguages(["ru-RU", "en-US"])).toEqual(["en", "ru"]);
  });

  it("drops languages boks does not publish, rather than storing them", () => {
    expect(normalizeReadingLanguages(["ja", "de", "ru"])).toEqual(["ru"]);
  });

  it("de-duplicates and returns a stable order", () => {
    expect(normalizeReadingLanguages(["RU", "ru-RU", "ru"])).toEqual(["ru"]);
    expect(normalizeReadingLanguages(["ru", "en"])).toEqual(normalizeReadingLanguages(["en", "ru"]));
  });

  it("treats nothing as nothing, which the caller reads as no filter", () => {
    expect(normalizeReadingLanguages(null)).toEqual([]);
    expect(normalizeReadingLanguages(["ja"])).toEqual([]);
  });
});

describe("effectiveReadingLanguages", () => {
  it("prefers the reader's own choice over anything else", () => {
    expect(effectiveReadingLanguages(["ru"])).toEqual(["ru"]);
  });
});

describe("describeEmptyLanguageFeed", () => {
  it("says nothing when the reader set no filter - an empty feed is then not about language", () => {
    expect(describeEmptyLanguageFeed([], { en: 400 })).toBeNull();
  });

  it("names the gap and offers the language that does have boks", () => {
    const message = describeEmptyLanguageFeed(["ru"], { en: 457, ru: 0 });

    expect(message?.title).toBe("No boks in Russian yet");
    expect(message?.body).toMatch(/plenty in English/);
    expect(message?.offer).toEqual(["en"]);
  });

  it("does not offer a language that is also empty", () => {
    const message = describeEmptyLanguageFeed(["ru"], { ru: 0 });

    expect(message?.offer).toEqual([]);
    expect(message?.body).toMatch(/nothing to show you yet/);
  });

  it("lists both languages when a bilingual reader somehow has nothing", () => {
    const message = describeEmptyLanguageFeed(["en", "ru"], {});
    expect(message?.title).toBe("No boks in English or Russian yet");
  });
});

describe("describeEmptyLanguageFeed in Russian", () => {
  it("names the languages in the prepositional case and offers what exists", () => {
    const message = describeEmptyLanguageFeed(["ru"], { en: 457, ru: 0 }, "ru");
    expect(message?.title).toBe("Пока нет текстов на русском");
    expect(message?.body).toContain("Зато много на английском");
    expect(message?.offer).toEqual(["en"]);
  });

  it("says so plainly when nothing exists at all", () => {
    const message = describeEmptyLanguageFeed(["en", "ru"], {}, "ru");
    expect(message?.title).toBe("Пока нет текстов на английском или русском");
    expect(message?.body).toBe("boks пока нечего вам показать. Ваши языки: английский и русский.");
  });

  it("reaches the notice through emptyFeedNotice", () => {
    const notice = emptyFeedNotice({ phase: "ready", message: "", languages: ["ru"], coverage: { en: 3 }, uiLanguage: "ru" });
    expect(notice.kind === "language" && notice.title).toBe("Пока нет текстов на русском");
  });
});

describe("emptyFeedNotice", () => {
  const coverage = { en: 457, ru: 0 };

  it("explains an empty feed to a reader whose filter caused it", () => {
    const notice = emptyFeedNotice({
      phase: "ready",
      message: "Ready",
      languages: ["ru"],
      coverage,
    });
    expect(notice.kind).toBe("language");
    if (notice.kind !== "language") throw new Error("expected the language notice");
    expect(notice.title).toContain("Russian");
    expect(notice.offer).toEqual(["en"]);
  });

  // The regression this replaces: the rule was keyed on the status *text*, so a
  // settled message of "Ready" fell through and the reader was shown the bare
  // word with no explanation and no way back.
  it("does not fall through when the settled message is a plain word", () => {
    for (const message of ["Ready", "", "Loading"]) {
      const notice = emptyFeedNotice({ phase: "ready", message, languages: ["ru"], coverage });
      expect(notice.kind).toBe("language");
    }
  });

  it("shows the error when the load failed, rather than blaming the language", () => {
    const notice = emptyFeedNotice({
      phase: "failed",
      message: "Could not load boks.",
      languages: ["ru"],
      coverage,
    });
    expect(notice).toEqual({ kind: "message", message: "Could not load boks." });
  });

  it("says nothing about languages while the feed is still loading", () => {
    const notice = emptyFeedNotice({
      phase: "loading",
      message: "Loading",
      languages: ["ru"],
      coverage,
    });
    expect(notice).toEqual({ kind: "message", message: "Loading" });
  });

  it("leaves a reader who narrowed nothing with the plain message", () => {
    const notice = emptyFeedNotice({
      phase: "ready",
      message: "Ready",
      languages: [],
      coverage,
    });
    expect(notice).toEqual({ kind: "message", message: "Ready" });
  });
});

describe("emptyFeedNotice and an unreachable server", () => {
  it("names the network when the failure was a network one", () => {
    const notice = emptyFeedNotice({
      phase: "failed",
      message: "boks-unreachable: the boks session did not answer within 8000 ms",
      languages: ["ru"],
      coverage: { ru: 348, en: 199 },
    });
    expect(notice.kind).toBe("unreachable");
  });

  it("leaves every other failure as the message it came with", () => {
    const notice = emptyFeedNotice({
      phase: "failed",
      message: "This boks account is suspended.",
      languages: ["ru"],
      coverage: { ru: 348 },
    });
    expect(notice).toEqual({ kind: "message", message: "This boks account is suspended." });
  });
});

describe("what a change of languages does to the feed", () => {
  it("keeps the feed when a language is added", () => {
    // The piece being read is still in a language the reader reads, and so is
    // everything queued behind it. Rebuilding here threw them out of it.
    expect(readingLanguageChangeKeepsFeed(["ru"], ["ru", "en"])).toBe(true);
    expect(readingLanguageChangeKeepsFeed(["en"], ["en", "ru"])).toBe(true);
  });

  it("keeps the feed when nothing actually changed", () => {
    expect(readingLanguageChangeKeepsFeed(["en", "ru"], ["ru", "en"])).toBe(true);
    expect(readingLanguageChangeKeepsFeed([], ["en"])).toBe(true);
  });

  it("rebuilds when a language is taken away", () => {
    // Now the boks on screen may be one the reader has just said they do not
    // read, so the feed has to go.
    expect(readingLanguageChangeKeepsFeed(["en", "ru"], ["ru"])).toBe(false);
    expect(readingLanguageChangeKeepsFeed(["en"], ["ru"])).toBe(false);
  });
});
