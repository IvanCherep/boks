/**
 * Light or dark, remembered per device.
 *
 * Three choices: follow the system (the default, so a phone already in dark
 * mode gets a dark boks without being asked), or always light, or always
 * dark. The choice lives in localStorage - a theme is about the screen in
 * front of the reader, and a laptop and a phone are often set differently.
 *
 * It is applied twice, and both must agree:
 *   - `themeBootScript` runs in <head> before the first paint, so a dark
 *     reader never sees a white flash while the app loads;
 *   - `applyTheme` runs when the reader changes the setting.
 * `theme.test.ts` runs the boot script against a fake page to hold them
 * together. The palette itself is `:root[data-theme="dark"]` in globals.css.
 */

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const themeStorageKey = "boks-theme";
export const themePreferences: readonly ThemePreference[] = ["system", "light", "dark"];

/** The page background per theme, for the mobile browser's own chrome. */
export const themeColor: Record<ResolvedTheme, string> = {
  light: "#f4f2ed",
  dark: "#141210",
};

/**
 * The poem and cinema players' own black. While one is open the status bar
 * above it - and, from the home screen, the whole top of the phone - should
 * be the picture's colour rather than the page's.
 */
export const playerChromeColor = "#05070d";

/** Native bars and overscroll use the same surface; null restores the theme. */
export function paintBrowserChrome(color: string | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (color) {
    root.dataset.browserChrome = color;
    root.style.setProperty("--browser-chrome", color);
  } else {
    delete root.dataset.browserChrome;
    root.style.removeProperty("--browser-chrome");
  }
  const theme: ResolvedTheme = root.dataset.theme === "dark" ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color ?? themeColor[theme]);
}

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): ThemeStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function systemPrefersDark() {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

export function readThemePreference(storage: ThemeStorage | null = defaultStorage()): ThemePreference {
  try {
    return parseThemePreference(storage?.getItem(themeStorageKey));
  } catch {
    return "system";
  }
}

export function writeThemePreference(preference: ThemePreference, storage: ThemeStorage | null = defaultStorage()) {
  try {
    storage?.setItem(themeStorageKey, preference);
  } catch {
    // Private mode or a full quota: the theme still applies for this visit.
  }
}

/** Puts a preference on the page: `data-theme`, native controls, browser chrome. */
export function applyTheme(preference: ThemePreference, prefersDark = systemPrefersDark()): ResolvedTheme {
  const resolved = resolveTheme(preference, prefersDark);
  if (typeof document === "undefined") return resolved;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", root.dataset.browserChrome ?? themeColor[resolved]);
  return resolved;
}

/**
 * The same rule as `readThemePreference` + `applyTheme`, as a string for an
 * inline <script>. It also follows the system while the preference is
 * "system", and follows a change made in another tab.
 */
export const themeBootScript = `(function () {
  var key = ${JSON.stringify(themeStorageKey)};
  var colors = ${JSON.stringify(themeColor)};
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function preference() {
    try {
      var value = window.localStorage.getItem(key);
      return value === "light" || value === "dark" ? value : "system";
    } catch (error) {
      return "system";
    }
  }
  function apply() {
    var chosen = preference();
    var theme = chosen === "system" ? (media && media.matches ? "dark" : "light") : chosen;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", root.dataset.browserChrome || colors[theme]);
  }
  apply();
  if (media) {
    if (media.addEventListener) media.addEventListener("change", apply);
    else if (media.addListener) media.addListener(apply);
  }
  window.addEventListener("storage", function (event) {
    if (event.key === key) apply();
  });
})();`;
