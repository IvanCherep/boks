/**
 * The one address a reader can write to.
 *
 * It is a real mailbox: `support@tryboks.com` is received by Cloudflare Email
 * Routing on the `tryboks.com` zone and forwarded to the owner's inbox. The
 * apex had no MX record at all before that, so anything a reader sent to the
 * domain - including a reply to a sign-in email - used to bounce.
 *
 * Kept here rather than typed into each page, because an address that appears
 * in Privacy, Terms and the settings panel is exactly the string that drifts.
 */
export const supportEmail = "support@tryboks.com";

/** `href` for a plain "write to us" link. No subject: the reader knows theirs. */
export const supportMailto = `mailto:${supportEmail}`;
