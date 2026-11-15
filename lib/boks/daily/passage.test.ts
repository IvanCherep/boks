import { describe, expect, it } from "vitest";
import { locatePassage, optionLabels, passageKey, passageProblem, tidyPassage, wholeShares } from "./passage";

const morning = [
  "Мороз и солнце; день чудесный!\nЕщё ты дремлешь, друг прелестный —\nПора, красавица, проснись:",
  "Вечор, ты помнишь, вьюга злилась,\nНа мутном небе мгла носилась;",
];

describe("tidyPassage", () => {
  it("keeps line breaks, folds blank lines and trims every line", () => {
    expect(tidyPassage("  Мороз и солнце;  день чудесный!\r\n\n\n\n  Ещё ты дремлешь ")).toBe("Мороз и солнце; день чудесный!\n\nЕщё ты дремлешь");
  });
});

describe("passageProblem", () => {
  const text = morning.join("\n\n");
  it("accepts words of the bok, however they are spaced or cased", () => {
    expect(passageProblem("мороз и  СОЛНЦЕ; день чудесный!", text)).toBeNull();
    expect(passageProblem("проснись:\n\nВечор, ты помнишь", text)).toBeNull();
  });
  it("refuses words that are not in it", () => {
    expect(passageProblem("Мороз и луна", text)).toBe("not-in-text");
  });
  it("refuses an empty or punctuation-only selection", () => {
    expect(passageProblem(" ", text)).toBe("empty");
    expect(passageProblem("—", text)).toBe("empty");
  });
  it("refuses more than a line or two", () => {
    expect(passageProblem("а".repeat(281), "а".repeat(400))).toBe("too-long");
  });
  it("compares the way the database does", () => {
    expect(passageKey("  Мороз\nи   Солнце ")).toBe("мороз и солнце");
  });
});

describe("locatePassage", () => {
  it("finds a line inside a stanza", () => {
    expect(locatePassage(morning, "день чудесный!")).toEqual([{ block: 0, start: morning[0].indexOf("день"), end: morning[0].indexOf("!") + 1 }]);
  });
  it("spans stanzas when the selection crossed one", () => {
    const ranges = locatePassage(morning, "проснись:\n\nВечор, ты помнишь");
    expect(ranges).toEqual([
      { block: 0, start: morning[0].indexOf("проснись:"), end: morning[0].length },
      { block: 1, start: 0, end: "Вечор, ты помнишь".length },
    ]);
  });
  it("matches across the line break of a verse", () => {
    const [range] = locatePassage(morning, "чудесный! Ещё ты")!;
    expect(morning[0].slice(range.start, range.end)).toBe("чудесный!\nЕщё ты");
  });
  it("reads ё as е, as readers and old editions do", () => {
    const [range] = locatePassage(["На груди утёса-великана;"], "на груди утеса")!;
    expect(range).toEqual({ block: 0, start: 0, end: "На груди утёса".length });
    expect(passageKey("Утёс")).toBe(passageKey("утес"));
  });
  it("is null when the words are gone", () => {
    expect(locatePassage(morning, "Буря мглою небо кроет")).toBeNull();
    expect(locatePassage(morning, "   ")).toBeNull();
  });
});

describe("optionLabels", () => {
  it("shows surnames", () => {
    expect(optionLabels(["Александр Пушкин", "Афанасий Фет", "Фёдор Тютчев"])).toEqual(["Пушкин", "Фет", "Тютчев"]);
  });
  it("shows full names when two surnames are the same", () => {
    expect(optionLabels(["Лев Толстой", "Алексей Толстой", "Иван Бунин"])).toEqual(["Лев Толстой", "Алексей Толстой", "Иван Бунин"]);
  });
  it("keeps a one-word name", () => {
    expect(optionLabels(["Саша Чёрный", "Гомер", "Emily Dickinson"])).toEqual(["Чёрный", "Гомер", "Dickinson"]);
  });
});

describe("wholeShares", () => {
  it("adds up to a hundred", () => {
    expect(wholeShares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(wholeShares([12, 24, 64])).toEqual([12, 24, 64]);
    expect(wholeShares([2, 3, 2]).reduce((a, b) => a + b)).toBe(100);
  });
  it("is all zero without answers", () => {
    expect(wholeShares([0, 0, 0])).toEqual([0, 0, 0]);
  });
});
