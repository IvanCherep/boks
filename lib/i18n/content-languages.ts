import type { UiLanguage } from "@/lib/i18n/ui-language";

/**
 * The languages texts are written in - not the interface's.
 *
 * Content can be in any language; the interface is in a few. A language is
 * named here by its endonym (what its own readers call it), which reads the
 * same whatever the interface is in, and needs no translation when Italian or
 * Serbian pieces arrive. A code missing from the table still gets a name from
 * `Intl.DisplayNames`, so adding a piece never waits on this file.
 */
export const contentLanguageEndonyms: Record<string, string> = {
  en: "English",
  ru: "Русский",
  it: "Italiano",
  sr: "Српски",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  uk: "Українська",
};

export function contentLanguageName(code: string, uiLanguage?: UiLanguage) {
  const known = contentLanguageEndonyms[code];
  if (known) return known;
  try {
    const name = new Intl.DisplayNames([code, uiLanguage ?? "en"], { type: "language" }).of(code);
    if (name && name !== code) return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    // An invalid tag: fall through to the code itself.
  }
  return code.toUpperCase();
}
