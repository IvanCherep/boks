import { describe, expect, it } from "vitest";
import { parseReaderPreferences } from "@/components/boks/reader-preferences";
import { bokShareUrl, wrapPosterText } from "@/components/boks/share-card-export";

describe("device reading preferences", () => {
  it("bounds malformed local preferences without changing the content language", () => {
    expect(parseReaderPreferences({ locale: "fr", textScale: Infinity, lineHeight: -20 })).toEqual({ locale: "en", textScale: 1, lineHeight: 1.5 });
    expect(parseReaderPreferences({ locale: "ru", textScale: 9, lineHeight: 3 })).toEqual({ locale: "ru", textScale: 1.35, lineHeight: 2.1 });
    expect(parseReaderPreferences(null)).toEqual({ locale: "en", textScale: 1, lineHeight: 1.65 });
  });
});

describe("real bok share poster", () => {
  it("links to the individual bok with its encoded id", () => {
    expect(bokShareUrl("a/b ?", "https://tryboks.com")).toBe("https://tryboks.com/b/a%2Fb%20%3F?card=v44-6");
  });

  it("wraps long words and Cyrillic titles without losing their characters", () => {
    const context = { measureText: (value: string) => ({ width: Array.from(value).length * 10 }) as TextMetrics };
    const title = "Сверхдлинноеназвание и ещё один бок";
    const lines = wrapPosterText(context, title, 80);
    expect(lines.every((line) => context.measureText(line).width <= 80)).toBe(true);
    expect(lines.join("").replaceAll(" ", "")).toBe(title.replaceAll(" ", ""));
  });
});
