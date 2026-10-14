"use client";

import { Languages } from "lucide-react";
import { defineMessages } from "@/lib/i18n/messages";
import { uiLanguageNames, uiLanguages, type UiLanguagePreference } from "@/lib/i18n/ui-language";
import {
  setUiLanguagePreference,
  useMessages,
  useUiLanguage,
  useUiLanguagePreference,
} from "@/components/boks/ui-language";

const words = defineMessages(
  {
    legend: "Interface language",
    system: "System",
    follows: (name: string) => `Follows your device: ${name}.`,
    fixed: "Texts keep their own language.",
    saved: "Saved on this device.",
  },
  {
    ru: {
      legend: "Язык интерфейса",
      system: "Системный",
      follows: (name: string) => `Как на устройстве: ${name}.`,
      fixed: "Тексты остаются на своём языке.",
      saved: "Сохраняется на этом устройстве.",
    },
  }
);

/**
 * System, or one language for good. The same segmented control as the theme,
 * so the account panel has one kind of switch. Language names are written in
 * their own language, so a reader stuck in the wrong one can still find theirs.
 */
export function UiLanguageSetting({ compact = false }: { compact?: boolean }) {
  const t = useMessages(words);
  const preference = useUiLanguagePreference();
  const current = useUiLanguage();
  const options: { value: UiLanguagePreference; label: string }[] = [
    { value: "system", label: t.system },
    ...uiLanguages.map((language) => ({ value: language, label: uiLanguageNames[language] })),
  ];

  return (
    <fieldset className={`theme-setting${compact ? " theme-setting--compact" : ""}`}>
      <legend className="text-sm font-medium">{t.legend}</legend>
      {!compact && (
        <p className="text-sm leading-6 text-[var(--muted-foreground)]">
          {preference === "system" ? `${t.follows(uiLanguageNames[current])} ` : ""}
          {t.fixed} {t.saved}
        </p>
      )}
      <div className="theme-options">
        {options.map(({ value, label }) => (
          <label key={value} className="theme-option" lang={value === "system" ? undefined : value}>
            <input
              type="radio"
              name={compact ? "boks-ui-language-compact" : "boks-ui-language"}
              value={value}
              checked={preference === value}
              onChange={() => setUiLanguagePreference(value)}
            />
            {value === "system" && <Languages className="size-4" aria-hidden="true" />}
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
