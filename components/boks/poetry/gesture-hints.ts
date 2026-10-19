import type { UiLanguage } from "@/lib/i18n/ui-language";

/**
 * A scene gesture's hint is written in English in the poem's scene map and
 * manifest - it is an instruction to the reader, so it is interface, not
 * poem. Other interface languages translate it here, by the English line.
 *
 * `gesture-hints.test.ts` reads every shipped manifest and fails on a hint
 * with no translation, so a new poem cannot ship an English cue into a
 * Russian interface by accident.
 */
export const gestureHintTranslations: Record<Exclude<UiLanguage, "en">, Record<string, string>> = {
  ru: {
    "Draw back and let go": "Натяните и отпустите",
    "Drag left for Eden, right for Mammon": "Влево - к Эдему, вправо - к Маммоне",
    "Drag a thread to a light": "Протяните нить к огоньку",
    "Hold to shelter the flame": "Удерживайте, чтобы укрыть пламя",
    "Hold to remember": "Удерживайте, чтобы вспомнить",
    "Swipe to turn the page": "Проведите, чтобы перевернуть страницу",
    "Hold the screen": "Удерживайте экран",
    "Hold the candle": "Удерживайте свечу",
    "Wipe the glass": "Протрите стекло",
    "Drag sideways to turn around": "Проведите в сторону, чтобы обернуться",
  },
};

export function gestureHintIn(hint: string, language: UiLanguage) {
  if (language === "en") return hint;
  return gestureHintTranslations[language][hint] ?? hint;
}
