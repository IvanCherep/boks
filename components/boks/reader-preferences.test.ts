import { describe, expect, it } from "vitest";
import { parseReaderPreferences } from "@/components/boks/reader-preferences";
import { bokShareUrl, wrapPosterText } from "@/components/boks/share-card-export";
import { authorShareUrl } from "@/lib/boks/share-link";

describe("device reading preferences", () => {
  it("bounds malformed local preferences without changing the content language", () => {
    expect(parseReaderPreferences({ locale: "fr", textScale: Infinity, lineHeight: -20 })).toEqual({ locale: "en", textScale: 1, lineHeight: 1.5 });
    expect(parseReaderPreferences({ locale: "ru", textScale: 9, lineHeight: 3 })).toEqual({ locale: "ru", textScale: 1.35, lineHeight: 2.1 });
    expect(parseReaderPreferences(null)).toEqual({ locale: "en", textScale: 1, lineHeight: 1.65 });
  });
});

describe("real bok share poster", () => {
  it("links to the individual bok with its encoded id", () => {
    expect(bokShareUrl({ id: "a/b ?" }, "http://localhost:3000")).toBe("http://localhost:3000/b/a%2Fb%20%3F");
    expect(bokShareUrl({ id: "cc7e3800-3567-42c1-ba08-8554a345e25c", slug: "kosa-prokhorov" }, "https://tryboks.com")).toBe("https://go.tryboks.com/b/kosa-prokhorov");
    expect(bokShareUrl({ id: "cc7e3800-3567-42c1-ba08-8554a345e25c", slug: null }, "https://tryboks.com")).toBe("https://go.tryboks.com/b/cc7e3800-3567-42c1-ba08-8554a345e25c");
    expect(authorShareUrl("@prokhorov", "https://tryboks.com")).toBe("https://go.tryboks.com/@prokhorov");
  });

  it("wraps long words and Cyrillic titles without losing their characters", () => {
    const context = { measureText: (value: string) => ({ width: Array.from(value).length * 10 }) as TextMetrics };
    const title = "Сверхдлинноеназвание и ещё один бок";
    const lines = wrapPosterText(context, title, 80);
    expect(lines.every((line) => context.measureText(line).width <= 80)).toBe(true);
    expect(lines.join("").replaceAll(" ", "")).toBe(title.replaceAll(" ", ""));
  });
});
