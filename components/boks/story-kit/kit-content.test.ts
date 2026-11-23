import { describe, expect, it } from "vitest";
import { defaultQuote, kitFileName, kitLanguage, manifestFrames, manifestLines, quotedLines, textLines, toggleQuoteLine, kitQuoteLimit } from "./kit-content";

const manifest = {
  scenes: [
    { id: "a", image: "/poetry/x/scenes/01.webp" },
    { id: "b", image: "/poetry/x/scenes/02.webp" },
  ],
  lines: [
    { sceneId: "a", tokens: [{ text: "Ночь," }, { text: "улица," }, { text: "фонарь" }] },
    { sceneId: "a", tokens: [{ text: "Бессмысленный" }, { text: "свет" }, { text: "." }] },
    { sceneId: "b", tokens: [{ text: "Живи" }, { text: "ещё" }] },
  ],
};

describe("story kit content", () => {
  it("quotes a Series only by the lines its recording reads", () => {
    expect(manifestLines(manifest)).toEqual(["Ночь, улица, фонарь", "Бессмысленный свет.", "Живи ещё"]);
  });

  it("gives every picture of a Series its own lines", () => {
    expect(manifestFrames(manifest)).toEqual([
      { image: "/poetry/x/scenes/01.webp", lines: ["Ночь, улица, фонарь", "Бессмысленный свет."] },
      { image: "/poetry/x/scenes/02.webp", lines: ["Живи ещё"] },
    ]);
  });

  it("keeps verse lines and cuts prose into sentences", () => {
    expect(textLines("Не жалею, не зову, не плачу,\n\nВсё пройдёт,  как с белых яблонь дым.")).toEqual(["Не жалею, не зову, не плачу,", "Всё пройдёт, как с белых яблонь дым."]);
    const prose = `${"Он шёл по улице и думал о своём, не замечая ни людей, ни снега, ни огней. ".repeat(2)}Потом остановился.`;
    expect(textLines(prose)).toHaveLength(3);
  });

  it("opens on the first stanza of verse, or two sentences of prose", () => {
    expect(defaultQuote(["а", "б", "в", "г", "д"])).toEqual([0, 1, 2, 3]);
    expect(defaultQuote(["x".repeat(120), "y".repeat(100), "z".repeat(90)])).toEqual([0, 1]);
  });

  it("refuses a line that would overfill the card", () => {
    const lines = Array.from({ length: 12 }, (_, index) => `строка ${index}`);
    const full = Array.from({ length: kitQuoteLimit.lines }, (_, index) => index);
    expect(toggleQuoteLine(lines, full, 10)).toBeNull();
    expect(toggleQuoteLine(lines, [0, 2], 1)).toEqual([0, 1, 2]);
    expect(toggleQuoteLine(lines, [0, 1], 0)).toEqual([1]);
  });

  it("marks a skip inside a passage", () => {
    expect(quotedLines(["a", "b", "c", "d"], [0, 1, 3])).toEqual(["a", "b", "…", "d"]);
  });

  it("speaks the language of the work and names files plainly", () => {
    expect(kitLanguage("Утёс")).toBe("ru");
    expect(kitLanguage("Ozymandias")).toBe("en");
    expect(kitFileName(["Не жалею, не зову", "story"])).toBe("boks-ne-zhaleyu-ne-zovu-story.jpg");
  });
});
