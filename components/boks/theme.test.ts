import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseThemePreference,
  readThemePreference,
  resolveTheme,
  themeBootScript,
  browserStatusBarColor,
  themeStorageKey,
  writeThemePreference,
  applyTheme,
} from "@/components/boks/theme";

describe("visible surface behind mobile browser chrome", () => {
  afterEach(() => vi.unstubAllGlobals());

  function page() {
    const root = { dataset: { theme: "light" } as Record<string, string>, style: {
      colorScheme: "light",
    } };
    const meta = { content: "", setAttribute: (_: string, value: string) => { meta.content = value; } };
    vi.stubGlobal("document", { documentElement: root, querySelector: () => meta });
    return { root, meta };
  }

  it("keeps the status bar black while the interface changes theme", () => {
    const { root, meta } = page();
    applyTheme("dark", false);
    expect(meta.content).toBe(browserStatusBarColor);
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
    applyTheme("light", true);
    expect(meta.content).toBe(browserStatusBarColor);
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("keeps the status bar black when following either system theme", () => {
    const { root, meta } = page();
    for (const dark of [true, false]) {
      applyTheme("system", dark);
      expect(meta.content).toBe(browserStatusBarColor);
      expect(root.dataset.theme).toBe(dark ? "dark" : "light");
    }
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
    expect(bootWith("dark", false)).toEqual({ theme: "dark", colorScheme: "dark", meta: browserStatusBarColor });
    expect(bootWith("light", true)).toEqual({ theme: "light", colorScheme: "light", meta: browserStatusBarColor });
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
