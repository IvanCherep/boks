import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseThemePreference,
  readThemePreference,
  resolveTheme,
  themeBootScript,
  themeColor,
  themeStorageKey,
  writeThemePreference,
  paintBrowserChrome,
  applyTheme,
} from "@/components/boks/theme";

describe("visible surface behind mobile browser chrome", () => {
  afterEach(() => vi.unstubAllGlobals());

  function page() {
    const properties = new Map<string, string>();
    const root = { dataset: { theme: "light" } as Record<string, string>, style: {
      colorScheme: "light",
      setProperty: (key: string, value: string) => properties.set(key, value),
      removeProperty: (key: string) => properties.delete(key),
    } };
    const meta = { content: "", setAttribute: (_: string, value: string) => { meta.content = value; } };
    vi.stubGlobal("document", { documentElement: root, querySelector: () => meta });
    return { root, meta, properties };
  }

  it("keeps the cover behind native bars when the theme changes, then restores the new theme", () => {
    const { root, meta, properties } = page();
    paintBrowserChrome("#9ba98a");
    applyTheme("dark", false);
    expect(meta.content).toBe("#9ba98a");
    expect(properties.get("--browser-chrome")).toBe("#9ba98a");
    paintBrowserChrome(null);
    expect(meta.content).toBe(themeColor.dark);
    expect(properties.has("--browser-chrome")).toBe(false);
    expect(root.dataset.browserChrome).toBeUndefined();
  });

  it("replaces player chrome with the next visible cover without retaining the old tint", () => {
    const { meta, properties } = page();
    paintBrowserChrome("#05070d");
    paintBrowserChrome("#8ca6b2");
    expect(meta.content).toBe("#8ca6b2");
    expect(properties.get("--browser-chrome")).toBe("#8ca6b2");
  });
});

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

/** Runs the <head> script against a stand-in page and reports what it set. */
function bootWith(stored: string | null, prefersDark: boolean) {
  const meta = { content: "", setAttribute(name: string, value: string) { if (name === "content") this.content = value; } };
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  const fakeDocument = {
    documentElement: root,
    querySelector: () => meta,
  };
  const fakeWindow = {
    localStorage: memoryStorage(stored === null ? {} : { [themeStorageKey]: stored }),
    matchMedia: () => ({ matches: prefersDark, addEventListener: () => undefined }),
    addEventListener: () => undefined,
  };
  new Function("window", "document", themeBootScript)(fakeWindow, fakeDocument);
  return { theme: root.dataset.theme, colorScheme: root.style.colorScheme, meta: meta.content };
}

describe("theme preference", () => {
  it("follows the system unless the reader chose otherwise", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("treats anything unrecognised as following the system", () => {
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("sepia")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
  });

  it("remembers the choice on the device", () => {
    const storage = memoryStorage();
    expect(readThemePreference(storage)).toBe("system");
    writeThemePreference("dark", storage);
    expect(readThemePreference(storage)).toBe("dark");
  });

  it("does not break when storage is unavailable", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readThemePreference(broken)).toBe("system");
    expect(() => writeThemePreference("dark", broken)).not.toThrow();
  });
});

describe("themeBootScript", () => {
  it("applies a stored choice before the app loads", () => {
    expect(bootWith("dark", false)).toEqual({ theme: "dark", colorScheme: "dark", meta: themeColor.dark });
    expect(bootWith("light", true)).toEqual({ theme: "light", colorScheme: "light", meta: themeColor.light });
  });

  it("follows the system when nothing is stored, as the app does", () => {
    for (const prefersDark of [true, false]) {
      expect(bootWith(null, prefersDark).theme).toBe(resolveTheme(readThemePreference(memoryStorage()), prefersDark));
    }
  });

  it("ignores a stored value it does not recognise", () => {
    expect(bootWith("sepia", true).theme).toBe("dark");
  });
});
