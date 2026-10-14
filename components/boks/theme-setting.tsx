"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  applyTheme,
  readThemePreference,
  resolveTheme,
  themeStorageKey,
  writeThemePreference,
  type ThemePreference,
} from "@/components/boks/theme";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";

const messages = defineMessages(
  {
    system: "System",
    light: "Light",
    dark: "Dark",
    legend: "Appearance",
    follows: (current: "light" | "dark") => `Follows your device, which is ${current} right now.`,
    always: (current: "light" | "dark") => `Always ${current}, whatever your device uses.`,
    saved: "Saved on this device.",
  },
  {
    ru: {
      system: "Системная",
      light: "Светлая",
      dark: "Тёмная",
      legend: "Тема",
      follows: (current: "light" | "dark") =>
        `Как на устройстве - сейчас ${current === "dark" ? "тёмная" : "светлая"}.`,
      always: (current: "light" | "dark") =>
        `Всегда ${current === "dark" ? "тёмная" : "светлая"}, что бы ни стояло на устройстве.`,
      saved: "Сохраняется на этом устройстве.",
    },
  }
);

const options: { value: ThemePreference; Icon: typeof Sun }[] = [
  { value: "system", Icon: Monitor },
  { value: "light", Icon: Sun },
  { value: "dark", Icon: Moon },
];

function prefersDarkNow() {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/**
 * Light, dark, or whatever the device uses. Native radio inputs, so arrow keys
 * and screen readers work without anything added; styled as one segmented
 * control. The choice is saved on this device the moment it is made.
 */
export function ThemeSetting({ compact = false }: { compact?: boolean }) {
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference());
  const [systemDark, setSystemDark] = useState(prefersDarkNow);
  const t = useMessages(messages);

  // Stay truthful while open: the device can switch at sunset, and another
  // tab can change the setting.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = () => setSystemDark(media.matches);
    const onStorage = (event: StorageEvent) => {
      if (event.key === themeStorageKey) setPreference(readThemePreference());
    };
    media.addEventListener?.("change", onMedia);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener?.("change", onMedia);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function choose(next: ThemePreference) {
    setPreference(next);
    writeThemePreference(next);
    applyTheme(next);
  }

  const current = resolveTheme(preference, systemDark);

  return (
    <fieldset className={`theme-setting${compact ? " theme-setting--compact" : ""}`}>
      <legend className="text-sm font-medium">{t.legend}</legend>
      {!compact && (
        <p className="text-sm leading-6 text-[var(--muted-foreground)]">
          {preference === "system" ? t.follows(current) : t.always(current)} {t.saved}
        </p>
      )}
      <div className="theme-options">
        {options.map(({ value, Icon }) => (
          <label key={value} className="theme-option">
            <input
              type="radio"
              name={compact ? "boks-theme-compact" : "boks-theme"}
              value={value}
              checked={preference === value}
              onChange={() => choose(value)}
            />
            <Icon className="size-4" aria-hidden="true" />
            <span>{t[value]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
