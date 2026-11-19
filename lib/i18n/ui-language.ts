/**
 * The language of the interface - buttons, sheets, notices - as opposed to the
 * language of a text, which is the text's own and never translated.
 *
 * The rule is the founder's: a device whose language is Russian gets the whole
 * interface in Russian, every other device gets English. Only the *first*
 * language the device names counts, because that is the one the person set it
 * to; a Russian speaker who keeps their phone in English has said what they
 * want to see. The account panel can override it either way, and the choice is
 * kept on this device, like the theme.
 *
 * Adding a language: add its code to `uiLanguages`, its name to
 * `uiLanguageNames`, and its column to every `defineMessages` call - the
 * typechecker names each one that is missing.
 */

export const uiLanguages = ["en", "ru"] as const;

export type UiLanguage = (typeof uiLanguages)[number];

export type UiLanguagePreference = "system" | UiLanguage;

export const defaultUiLanguage: UiLanguage = "en";

/** Each language in its own words: a reader who cannot read the current one can still find theirs. */
export const uiLanguageNames: Record<UiLanguage, string> = {
  en: "English",
  ru: "Русский",
};

export const uiLanguageStorageKey = "boks-ui-language";

/**
 * The same choice as a cookie, so the server renders the page in it: without
 * one the first paint was English on every device until the client switched
 * (most visible when a phone reloads a tab it had put to sleep). Only the
 * choice, never anything about the person.
 */
export const uiLanguageCookie = "boks-ui-language";
const uiLanguageCookieMaxAge = 60 * 60 * 24 * 400;

/** `boks-ui-language=ru; path=/; …` for the browser to keep. */
export function uiLanguageCookieValue(preference: UiLanguagePreference) {
  return `${uiLanguageCookie}=${preference}; path=/; max-age=${uiLanguageCookieMaxAge}; samesite=lax`;
}

/**
 * The interface language of a request, by the device rule on the server:
 * the reader's choice from the cookie, else the first language the browser
 * names in `Accept-Language` (the same list as `navigator.languages`, in the
 * same order), else English.
 */
export function uiLanguageFromRequest(cookieHeader: string | null | undefined, acceptLanguage: string | null | undefined): UiLanguage {
  const chosen = /(?:^|;\s*)boks-ui-language=([^;]*)/.exec(cookieHeader ?? "")?.[1];
  const preference = parseUiLanguagePreference(chosen ? decodeURIComponent(chosen) : null);
  if (preference !== "system") return preference;
  const first = String(acceptLanguage ?? "").split(",")[0]?.split(";")[0] ?? "";
  return uiLanguageFromDevice([first]);
}

export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === "string" && (uiLanguages as readonly string[]).includes(value);
}

export function parseUiLanguagePreference(value: unknown): UiLanguagePreference {
  return isUiLanguage(value) ? value : "system";
}

/** `ru-RU` → `ru`; the device's first language decides, anything we do not carry is English. */
export function uiLanguageFromDevice(languages: readonly string[] | null | undefined): UiLanguage {
  const first = String(languages?.[0] ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return isUiLanguage(first) ? first : defaultUiLanguage;
}

export function resolveUiLanguage(
  preference: UiLanguagePreference,
  deviceLanguages: readonly string[] | null | undefined
): UiLanguage {
  return preference === "system" ? uiLanguageFromDevice(deviceLanguages) : preference;
}

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): PreferenceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function deviceLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

export function readUiLanguagePreference(storage: PreferenceStorage | null = defaultStorage()): UiLanguagePreference {
  try {
    return parseUiLanguagePreference(storage?.getItem(uiLanguageStorageKey));
  } catch {
    return "system";
  }
}

export function writeUiLanguagePreference(
  preference: UiLanguagePreference,
  storage: PreferenceStorage | null = defaultStorage()
) {
  try {
    storage?.setItem(uiLanguageStorageKey, preference);
  } catch {
    // Private mode: the language still applies for this visit.
  }
  if (typeof document !== "undefined") document.cookie = uiLanguageCookieValue(preference);
}

/**
 * Sets `<html lang>` before first paint, by the same rule as
 * `resolveUiLanguage`, so screen readers and hyphenation are right from the
 * start. `ui-language.test.ts` runs it against a fake page.
 */
export const uiLanguageBootScript = `(function () {
  var key = ${JSON.stringify(uiLanguageStorageKey)};
  var known = ${JSON.stringify(uiLanguages)};
  var chosen = "system";
  try { chosen = window.localStorage.getItem(key) || "system"; } catch (error) {}
  var lang = known.indexOf(chosen) >= 0 ? chosen : null;
  if (!lang) {
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    var first = String(list[0] || "").toLowerCase().split(/[-_]/)[0];
    lang = known.indexOf(first) >= 0 ? first : ${JSON.stringify(defaultUiLanguage)};
  }
  document.documentElement.lang = lang;
  // A choice made before the cookie existed reaches the server from now on.
  try {
    var mark = ${JSON.stringify(uiLanguageCookie)} + "=" + chosen;
    if (document.cookie.split("; ").indexOf(mark) < 0) document.cookie = mark + "; path=/; max-age=34560000; samesite=lax";
  } catch (error) {}
})();`;
