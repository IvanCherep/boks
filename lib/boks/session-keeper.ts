/**
 * Keeping a reader signed in when the browser forgets them.
 *
 * The session lives in localStorage (supabase-js), and browsers empty it on
 * their own: Safari after seven days without a visit, in-app browsers between
 * openings, storage cleaners. The server never ends a session (GoTrue
 * refresh tokens do not expire), so a reader who signed in once should not
 * have to again. The refresh token is also kept in a first-party cookie the
 * page cannot read (HttpOnly), set by our own server, for half a year:
 * `/api/session/restore` trades it for a fresh session when localStorage
 * comes back empty. Signing out clears it.
 *
 * Only signed-in accounts are kept; a guest's session is not worth a cookie.
 */

export const keptSessionCookie = "boks_session";
/** Half a year; renewed with every refresh, so an active reader never reaches it. */
export const keptSessionMaxAgeSeconds = 180 * 24 * 60 * 60;
/** Sent only to the two routes that use it. */
export const keptSessionPath = "/api/session";

/** GoTrue refresh tokens are short opaque strings; anything else is refused. */
export function isPlausibleRefreshToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,256}$/.test(value);
}

/** Local development runs over plain http; everywhere else the cookie is Secure. */
export function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}

export function keptSessionSetCookie(refreshToken: string, secure: boolean) {
  return [
    `${keptSessionCookie}=${refreshToken}`,
    `Path=${keptSessionPath}`,
    `Max-Age=${keptSessionMaxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function keptSessionClearCookie(secure: boolean) {
  return [`${keptSessionCookie}=`, `Path=${keptSessionPath}`, "Max-Age=0", "HttpOnly", "SameSite=Strict", ...(secure ? ["Secure"] : [])].join("; ");
}

export function readKeptSession(cookieHeader: string | null | undefined): string | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === keptSessionCookie) {
      const value = rest.join("=");
      return isPlausibleRefreshToken(value) ? value : null;
    }
  }
  return null;
}

/**
 * The two routes answer only the site itself: a page elsewhere cannot make a
 * reader's browser save a token or hand one back (SameSite=Strict does most of
 * this; the Origin check covers the rest).
 */
export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers send none
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Whether the request reached us over https (Caddy terminates TLS and says so). */
export function isSecureRequest(request: Request) {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  const url = new URL(request.url);
  return url.protocol === "https:" || !isLocalHostname(url.hostname);
}
