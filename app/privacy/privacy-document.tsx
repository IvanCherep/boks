"use client";

import { useUiLanguage } from "@/components/boks/ui-language";
import { PrivacyEn } from "./privacy-en";
import { PrivacyRu } from "./privacy-ru";

/**
 * The page in the interface language. The language is a client decision
 * (ADR 0015), so the server renders English and the first client render
 * switches; both texts say the same thing and change together.
 */
export function PrivacyDocument() {
  return useUiLanguage() === "ru" ? <PrivacyRu /> : <PrivacyEn />;
}
