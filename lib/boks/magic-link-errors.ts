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
export function describeMagicLinkRedirectError(raw: string | null | undefined): string {
  const message = (raw ?? "").replace(/\+/g, " ").toLowerCase();

  if (message.includes("code verifier") || message.includes("pkce") || message.includes("flow state")) {
    return "This sign-in link opened in a different browser or app than the one that asked for it. Request a new link here, then open it in this same browser.";
  }
  if (
    message.includes("expired") ||
    message.includes("otp") ||
    message.includes("invalid") ||
    message.includes("already been used") ||
    message.includes("not found")
  ) {
    return "This sign-in link has expired or was already used. Request a new one - only the newest link works.";
  }
  return "That sign-in link did not work. Request a new one and open it in this browser.";
}
