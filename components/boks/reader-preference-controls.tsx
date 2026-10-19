"use client";

import { Check, Globe } from "lucide-react";
import { useReaderPreferences } from "@/components/boks/reader-preferences";
import { ReaderTypeIcon as Type } from "./reader/reader-icons";
import { Button } from "@/components/ui/button";
import { setUiLanguagePreference, useMessages, useUiLanguagePreference } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";

const languageMessages = defineMessages({ system: "Use device language" }, { ru: { system: "Как на устройстве" } });

export function ReaderPreferenceControls({ page, onDone }: { page?: "app-language" | "typography"; onDone?: () => void }) {
  const { preferences, updatePreferences, t } = useReaderPreferences();
  const languagePreference = useUiLanguagePreference();
  const languageWords = useMessages(languageMessages);
  return <div className={`you-preferences${page ? " you-preferences--page" : ""}`}>
    {page && <h1 className="social-display">{page === "app-language" ? t("App language", "Язык приложения") : t("Text settings.", "Настройки текста.")}</h1>}
    {page !== "typography" && <details className="settings-disclosure you-setting" open={page ? true : undefined}>
      <summary><span><strong>{t("App language", "Язык приложения")}</strong><small>{preferences.locale === "en" ? "English" : "Русский"}</small></span><Globe /></summary>
      <div className="settings-disclosure__body">
        <p>{t("Menus and buttons. Your boks stay in their original language.", "Меню и кнопки. Боки остаются на языке оригинала.")}</p>
        <fieldset className="you-locale"><legend className="sr-only">{t("App language", "Язык приложения")}</legend>
          {([['en', 'Aa', 'English'], ['ru', 'Аа', 'Русский'], ['system', '↺', languageWords.system]] as const).map(([value, letters, label]) => <label key={value}>
            <input type="radio" name="boks-app-locale" value={value} checked={languagePreference === value} onChange={() => value === 'system' ? setUiLanguagePreference('system') : updatePreferences({ locale: value })} />
            <span aria-hidden="true">{letters}</span><strong lang={value === 'system' ? undefined : value}>{label}</strong><Check />
          </label>)}
        </fieldset>
        <p className="social-note">{t("Applies immediately. Saved on this device.", "Применяется сразу. Сохраняется на этом устройстве.")}</p>
      </div>
    </details>}
    {page !== "app-language" && <details className="settings-disclosure you-setting" open={page ? true : undefined}>
      <summary><span><strong>{t("Reading comfort", "Удобство чтения")}</strong><small>{t("Text size and line spacing", "Размер текста и интервал")}</small></span><Type /></summary>
      <div className="settings-disclosure__body">
        <div className="you-type-sample"><span className="social-eyebrow">{t("Live preview", "Живой образец")}</span><p style={{ fontSize: `${20 * preferences.textScale}px`, lineHeight: preferences.lineHeight }}>
          {t('“Hope” is the thing with feathers —\nThat perches in the soul —\nAnd sings the tune without the words —\nAnd never stops — at all —', 'Белеет парус одинокий\nВ тумане моря голубом!..\nЧто ищет он в стране далёкой?\nЧто кинул он в краю родном?..')}
        </p></div>
        <div className="you-control"><div><strong>{t("Text size", "Размер текста")}</strong><small>{Math.round(preferences.textScale * 100)}%</small></div><div className="you-size-controls">
          <button type="button" disabled={preferences.textScale <= .85} aria-label={t("Smaller text", "Уменьшить текст")} onClick={() => updatePreferences({ textScale: Math.round((preferences.textScale - .1) * 100) / 100 })}>A−</button>
          <button type="button" disabled={preferences.textScale >= 1.35} aria-label={t("Larger text", "Увеличить текст")} onClick={() => updatePreferences({ textScale: Math.round((preferences.textScale + .1) * 100) / 100 })}>A+</button>
        </div></div>
        <label className="you-control"><span><strong>{t("Line spacing", "Межстрочный интервал")}</strong><small>{t("Space between lines", "Расстояние между строками")}</small></span><select value={preferences.lineHeight} onChange={(event) => updatePreferences({ lineHeight: Number(event.target.value) })}>
          <option value={1.5}>{t("Compact", "Компактный")}</option><option value={1.65}>{t("Normal", "Обычный")}</option><option value={2.1}>{t("Relaxed", "Свободный")}</option>
        </select></label>
        <div className="you-control you-motion-control"><span><strong>{t("Page movement", "Движение страниц")}</strong><small>{t("Respects your device preference", "Учитывает настройку устройства")}</small></span><span>{t("System", "Системное")}</span></div>
      </div>
    </details>}
    {page === "typography" && onDone && <Button className="you-wide-button" onClick={onDone}>{t("Back to reading", "Вернуться к чтению")}</Button>}
  </div>;
}
