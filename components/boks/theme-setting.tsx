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

const options: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
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
      <legend className="text-sm font-medium">Appearance</legend>
      {!compact && (
        <p className="text-sm leading-6 text-[var(--muted-foreground)]">
          {preference === "system"
            ? `Follows your device, which is ${current} right now.`
            : `Always ${current}, whatever your device uses.`}{" "}
          Saved on this device.
        </p>
      )}
      <div className="theme-options">
        {options.map(({ value, label, Icon }) => (
          <label key={value} className="theme-option">
            <input
              type="radio"
              name={compact ? "boks-theme-compact" : "boks-theme"}
              value={value}
              checked={preference === value}
              onChange={() => choose(value)}
            />
            <Icon className="size-4" aria-hidden="true" />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
