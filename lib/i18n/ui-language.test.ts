import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { defineMessages, plural } from "@/lib/i18n/messages";
import {
  parseUiLanguagePreference,
  resolveUiLanguage,
  uiLanguageBootScript,
  uiLanguageFromDevice,
  uiLanguageStorageKey,
} from "@/lib/i18n/ui-language";

describe("interface language", () => {
  it("is Russian only when the device's own language is Russian", () => {
    expect(uiLanguageFromDevice(["ru-RU", "en-US"])).toBe("ru");
    expect(uiLanguageFromDevice(["ru"])).toBe("ru");
    expect(uiLanguageFromDevice(["en-US", "ru-RU"])).toBe("en");
    expect(uiLanguageFromDevice(["it-IT"])).toBe("en");
    expect(uiLanguageFromDevice(["sr-Latn-RS"])).toBe("en");
    expect(uiLanguageFromDevice([])).toBe("en");
  });

  it("follows the reader's choice over the device", () => {
    expect(resolveUiLanguage("en", ["ru-RU"])).toBe("en");
    expect(resolveUiLanguage("ru", ["en-US"])).toBe("ru");
    expect(resolveUiLanguage("system", ["ru-RU"])).toBe("ru");
  });

  it("treats anything unknown as following the device", () => {
    expect(parseUiLanguagePreference("de")).toBe("system");
    expect(parseUiLanguagePreference(null)).toBe("system");
    expect(parseUiLanguagePreference("ru")).toBe("ru");
  });

  function boot(stored: string | null, languages: string[]) {
    const root = { lang: "" };
    runInNewContext(uiLanguageBootScript, {
      window: { localStorage: { getItem: (key: string) => (key === uiLanguageStorageKey ? stored : null) } },
      navigator: { languages, language: languages[0] },
      document: { documentElement: root },
    });
    return root.lang;
  }

  it("boot script agrees with the rule", () => {
    for (const [stored, languages] of [
      [null, ["ru-RU", "en"]],
      [null, ["en-GB", "ru"]],
      ["en", ["ru-RU"]],
      ["ru", ["it-IT"]],
      ["nonsense", ["ru"]],
    ] as const) {
      expect(boot(stored, [...languages])).toBe(resolveUiLanguage(parseUiLanguagePreference(stored), languages));
    }
  });
});

describe("messages", () => {
  it("chooses plural forms per language", () => {
    const scenes = (language: "en" | "ru", n: number) =>
      plural(language, n, language === "ru" ? { one: "сцена", few: "сцены", many: "сцен", other: "сцены" } : { one: "scene", other: "scenes" });
    expect([1, 2, 5, 21].map((n) => scenes("ru", n))).toEqual(["сцена", "сцены", "сцен", "сцена"]);
    expect([1, 2].map((n) => scenes("en", n))).toEqual(["scene", "scenes"]);
  });

  it("keeps every language in the table", () => {
    const table = defineMessages({ hi: "Hello" }, { ru: { hi: "Привет" } });
    expect(table.ru.hi).toBe("Привет");
    expect(table.en.hi).toBe("Hello");
  });
});
