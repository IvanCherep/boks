/**
 * The link an editor copies for an invited author.
 *
 * The token rides in the fragment (`/author#invite=<token>`): a browser never
 * sends a fragment to a server, so it cannot reach an access log or a
 * referrer. The cabinet reads it, keeps it for this tab only while the person
 * signs in with the code from their email, and forgets it once accepted.
 */

const tokenPattern = /^[0-9a-f]{64}$/;

export function inviteLink(origin: string, token: string) {
  return `${origin.replace(/\/+$/, "")}/author#invite=${token}`;
}

/** The token in a location hash, or null. */
export function inviteTokenFromHash(hash: string): string | null {
  const match = /(?:^#?|&)invite=([^&]+)/.exec(hash.replace(/^#/, ""));
  if (!match) return null;
  const token = decodeURIComponent(match[1]).toLowerCase();
  return tokenPattern.test(token) ? token : null;
}

export const pendingInviteKey = "boks.pendingInvite";
