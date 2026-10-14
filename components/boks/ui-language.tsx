"use client";

import { useSyncExternalStore } from "react";
import type { Messages } from "@/lib/i18n/messages";
import {
  defaultUiLanguage,
  deviceLanguages,
  readUiLanguagePreference,
  resolveUiLanguage,
  uiLanguageStorageKey,
  writeUiLanguagePreference,
  type UiLanguage,
  type UiLanguagePreference,
} from "@/lib/i18n/ui-language";

/**
 * The interface language, shared by every component without a provider.
 *
 * The server does not know the device, so it renders English and the first
 * client render switches; `useSyncExternalStore` makes that the hydration
 * contract rather than a mismatch. The reader's first screen is a loading
 * state, so nothing readable flips.
 */

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === uiLanguageStorageKey) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("languagechange", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("languagechange", listener);
  };
}

export function currentUiLanguage(): UiLanguage {
  if (typeof window === "undefined") return defaultUiLanguage;
  return resolveUiLanguage(readUiLanguagePreference(), deviceLanguages());
}

export function useUiLanguage(): UiLanguage {
  return useSyncExternalStore(subscribe, currentUiLanguage, () => defaultUiLanguage);
}

export function useUiLanguagePreference(): UiLanguagePreference {
  return useSyncExternalStore(subscribe, () => readUiLanguagePreference(), () => "system" as const);
}

export function setUiLanguagePreference(preference: UiLanguagePreference) {
  writeUiLanguagePreference(preference);
  if (typeof document !== "undefined") document.documentElement.lang = currentUiLanguage();
  notify();
}

/** The words of one table in the current interface language. */
export function useMessages<T>(table: Messages<T>): T {
  return table[useUiLanguage()];
}
