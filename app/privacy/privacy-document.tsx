"use client";

import { LegalDocument, useLegalLanguage } from "@/components/boks/legal/legal-layout";
import { privacyEn } from "./privacy-en";
import { privacyRu } from "./privacy-ru";

/**
 * The page in the edition the address names (`?lang=ru|en`), else in the
 * interface language (ADR 0015). The server renders English and the first
 * client render switches; both texts say the same thing and change together.
 */
export function PrivacyDocument() {
  const { language, explicit } = useLegalLanguage();
  return <LegalDocument page="privacy" language={language} explicit={explicit} {...(language === "ru" ? privacyRu : privacyEn)} />;
}
