const baseDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
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

export function contentSecurityPolicy(supabaseUrl?: string) {
  // The beacon reports to `cloudflareinsights.com/cdn-cgi/rum`, a different
  // host from the one it is served from.
  const connectSources = ["'self'", ...supabaseConnectSources(supabaseUrl), "https://cloudflareinsights.com"];
  return [...baseDirectives, `connect-src ${connectSources.join(" ")}`, "upgrade-insecure-requests"].join("; ");
}

export function applySecurityHeaders(response: Response, requestUrl: URL, supabaseUrl?: string) {
  response.headers.set("Content-Security-Policy", contentSecurityPolicy(supabaseUrl));
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set(
    "Permissions-Policy",
    "browsing-topics=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()"
  );
  if (requestUrl.protocol === "https:") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  return response;
}
