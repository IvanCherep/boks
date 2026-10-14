import {
  deviceLanguages,
  readUiLanguagePreference,
  resolveUiLanguage,
  type UiLanguage,
} from "@/lib/i18n/ui-language";

const words = {
  en: {
    otherBrowser:
      "This sign-in link opened in a different browser or app than the one that asked for it. Request a new link here, then open it in this same browser.",
    expired: "This sign-in link has expired or was already used. Request a new one - only the newest link works.",
    unknown: "That sign-in link did not work. Request a new one and open it in this browser.",
  },
  ru: {
    otherBrowser:
      "Ссылка для входа открылась не в том браузере или приложении, где её запросили. Запросите новую ссылку здесь и откройте её в этом же браузере.",
    expired: "Ссылка для входа устарела или уже использована. Запросите новую - работает только самая свежая.",
    unknown: "Ссылка для входа не сработала. Запросите новую и откройте её в этом браузере.",
  },
} satisfies Record<UiLanguage, Record<string, string>>;

/** Outside React: the interface language this page is showing. English on the server. */
function pageLanguage(): UiLanguage {
  if (typeof window === "undefined") return "en";
  return resolveUiLanguage(readUiLanguagePreference(), deviceLanguages());
}

/**
 * What a reader is told when an email sign-in link does not work.
 *
 * Supabase hands back its own wording - "PKCE code verifier not found in
 * storage. This can happen if the auth flow was initiated in a different
 * browser or device, or if the storage was cleared. For SSR frameworks
 * (Next.js, SvelteKit, etc.), use @supabase/ssr..." - and that used to be shown
 * to the reader as is. The common real cause is a phone: the link is requested
 * in Safari and tapped in the Gmail app, which opens it in its own browser,
 * where the sign-in that was started does not exist.
 */
export function describeMagicLinkRedirectError(
  raw: string | null | undefined,
  language: UiLanguage = pageLanguage()
): string {
  const t = words[language];
  const message = (raw ?? "").replace(/\+/g, " ").toLowerCase();

  if (message.includes("code verifier") || message.includes("pkce") || message.includes("flow state")) {
    return t.otherBrowser;
  }
  if (
    message.includes("expired") ||
    message.includes("otp") ||
    message.includes("invalid") ||
    message.includes("already been used") ||
    message.includes("not found")
  ) {
    return t.expired;
  }
  return t.unknown;
}
