"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { currentUiLanguage, setUiLanguagePreference, useUiLanguage } from "@/components/boks/ui-language";

export type ReaderPreferences = { locale: "en" | "ru"; textScale: number; lineHeight: number };
export const readerPreferencesKey = "boks-reader-preferences";
const changedEvent = "boks-reader-preferences-change";
const defaults: ReaderPreferences = { locale: "en", textScale: 1, lineHeight: 1.65 };
let cachedRaw: string | null | undefined;
let cachedPreferences = defaults;

/** Device preferences only; these never change the languages offered by the feed. */
export function parseReaderPreferences(value: unknown): ReaderPreferences {
  const input = value && typeof value === "object" ? value as Partial<ReaderPreferences> : {};
  return {
    locale: input.locale === "ru" ? "ru" : "en",
    textScale: typeof input.textScale === "number" && Number.isFinite(input.textScale)
      ? Math.max(0.85, Math.min(1.35, input.textScale)) : 1,
    lineHeight: typeof input.lineHeight === "number" && Number.isFinite(input.lineHeight)
      ? Math.max(1.5, Math.min(2.1, input.lineHeight)) : 1.65,
  };
}

function readPreferences() {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(readerPreferencesKey);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      try { cachedPreferences = parseReaderPreferences(raw ? JSON.parse(raw) : null); }
      catch { cachedPreferences = defaults; }
    }
  } catch { /* A blocked store must not prevent reading or this visit's choices. */ }
  return cachedPreferences;
}

function applyPreferences(preferences: ReaderPreferences) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = preferences.locale;
  document.documentElement.style.setProperty("--reader-text-scale", String(preferences.textScale));
  document.documentElement.style.setProperty("--reader-line-height", String(preferences.lineHeight));
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === readerPreferencesKey || event.key === null) listener();
  };
  window.addEventListener(changedEvent, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(changedEvent, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function updateReaderPreferences(patch: Partial<ReaderPreferences>) {
  if (patch.locale) setUiLanguagePreference(patch.locale);
  const preferences = parseReaderPreferences({ ...readPreferences(), ...patch });
  cachedPreferences = preferences;
  const raw = JSON.stringify(preferences);
  try { window.localStorage.setItem(readerPreferencesKey, raw); cachedRaw = raw; } catch { /* Keep this visit's choice. */ }
  applyPreferences({ ...preferences, locale: currentUiLanguage() });
  window.dispatchEvent(new Event(changedEvent));
}

export function useReaderPreferences() {
  const stored = useSyncExternalStore(subscribe, readPreferences, () => defaults);
  const locale = useUiLanguage();
  const preferences = useMemo(() => ({ ...stored, locale }), [stored, locale]);
  useEffect(() => applyPreferences(preferences), [preferences]);
  return {
    preferences,
    updatePreferences: updateReaderPreferences,
    t: (english: string, russian: string) => preferences.locale === "ru" ? russian : english,
  };
}
