import { currentUiLanguage } from "@/components/boks/ui-language";
import type { UiLanguage } from "@/lib/i18n/ui-language";

/**
 * "🇷🇸 Serbia" from "RS".
 *
 * The flag is built from the two regional-indicator letters, which every
 * current platform renders as a flag; the name comes from the browser's own
 * locale data, so nothing is maintained here. An unknown code - there are none
 * today, but Cloudflare adds them - falls back to the code itself.
 */
export function countryFlag(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

const names = new Map<UiLanguage, Intl.DisplayNames>();

/** Named in the interface language. */
export function countryName(code: string, language: UiLanguage = currentUiLanguage()) {
  if (code === "unknown") return language === "ru" ? "Неизвестно" : "Unknown";
  try {
    let display = names.get(language);
    if (!display) {
      display = new Intl.DisplayNames([language], { type: "region" });
      names.set(language, display);
    }
    return display.of(code) ?? code;
  } catch {
    return code;
  }
}

export function countryLabel(code: string, language: UiLanguage = currentUiLanguage()) {
  const flag = countryFlag(code);
  return flag ? `${flag} ${countryName(code, language)}` : countryName(code, language);
}
