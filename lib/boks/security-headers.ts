const baseDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  // vinext currently emits the RSC bootstrap as inline scripts.
  "script-src 'self' 'unsafe-inline'",
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
  const connectSources = ["'self'", ...supabaseConnectSources(supabaseUrl)];
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
