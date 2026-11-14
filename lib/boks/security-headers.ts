const baseDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  // The formats play their recordings from an in-memory copy (an object URL),
  // because the asset server answers a range request with the whole file and
  // a 200, and a streamed file that cannot be ranged cannot be seeked. Without
  // `blob:` here the copy is refused under `default-src`: the poem would not
  // play at all once it swapped, and the cinema fell back to the browser voice.
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  // vinext currently emits the RSC bootstrap as inline scripts.
  //
  // Cloudflare injects its Web Analytics beacon into every response from the
  // edge, so a policy that names only 'self' silently turns that analytics off
  // - which is what happened here between 25 and 27 September, found by
  // reading the console on production rather than by anyone noticing the
  // numbers stop. The beacon is named exactly, not by a wildcard.
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
];

function supabaseConnectSources(supabaseUrl?: string) {
  if (!supabaseUrl) return [];
  try {
    const url = new URL(supabaseUrl);
    const websocketProtocol = url.protocol === "http:" ? "ws:" : "wss:";
    return [url.origin, `${websocketProtocol}//${url.host}`];
  } catch {
    return [];
  }
}

/**
 * Pages Studio shows inside its own frame: the author-page preview at
 * desktop and phone width. Only boks itself may frame them; every other page
 * refuses any frame at all.
 */
export function framedBySelf(pathname: string) {
  return pathname === "/author/preview" || pathname.startsWith("/author/preview/");
}

/**
 * A development server on this machine. Safari applies
 * `upgrade-insecure-requests` to localhost too (Chrome exempts it), so over
 * plain http every script and stylesheet was asked for over https and failed.
 */
export function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}

export function contentSecurityPolicy(supabaseUrl?: string, options: { framedBySelf?: boolean; local?: boolean } = {}) {
  // The beacon reports to `cloudflareinsights.com/cdn-cgi/rum`, a different
  // host from the one it is served from.
  const connectSources = ["'self'", ...supabaseConnectSources(supabaseUrl), "https://cloudflareinsights.com"];
  const frameAncestors = options.framedBySelf ? "frame-ancestors 'self'" : "frame-ancestors 'none'";
  return [
    ...baseDirectives.slice(0, 3),
    frameAncestors,
    ...baseDirectives.slice(3),
    `connect-src ${connectSources.join(" ")}`,
    ...(options.local ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function applySecurityHeaders(response: Response, requestUrl: URL, supabaseUrl?: string) {
  const selfFramed = framedBySelf(requestUrl.pathname);
  response.headers.set(
    "Content-Security-Policy",
    contentSecurityPolicy(supabaseUrl, { framedBySelf: selfFramed, local: isLocalHost(requestUrl.hostname) })
  );
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", selfFramed ? "SAMEORIGIN" : "DENY");
  response.headers.set(
    "Permissions-Policy",
    "browsing-topics=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()"
  );
  if (requestUrl.protocol === "https:") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  return response;
}
