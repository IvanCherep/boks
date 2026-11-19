"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
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
 * The server renders in the language of the request (`uiLanguageFromRequest`:
 * the reader's choice from its cookie, else the device's first language from
 * `Accept-Language`), handed down by `UiLanguageProvider` from the root
 * layout. Hydration uses that same value, and the client then reads its own
 * storage and device; they agree, so nothing flips. Without the provider (a
 * test, a page outside the layout) the server's value is English, as before.
 */
const RequestUiLanguage = createContext<UiLanguage>(defaultUiLanguage);

export function UiLanguageProvider({ value, children }: { value: UiLanguage; children: ReactNode }) {
  return <RequestUiLanguage.Provider value={value}>{children}</RequestUiLanguage.Provider>;
}

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
  const requested = useContext(RequestUiLanguage);
  return useSyncExternalStore(subscribe, currentUiLanguage, () => requested);
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
