import { NextResponse, type NextRequest } from "next/server";
import { canonicalRedirect } from "@/lib/boks/canonical-host";
import { applySecurityHeaders } from "@/lib/boks/security-headers";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;

/**
 * Sends the old host to tryboks.com. The rule, and why it exists, is in
 * `lib/boks/canonical-host.ts`; this file only applies it.
 *
 * 308 rather than 301: permanent, and it keeps the method, so nothing that
 * reaches here as a POST is quietly turned into a GET.
 */
export function proxy(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const target = canonicalRedirect(requestUrl, request.headers.get("host"));
  const response = target ? NextResponse.redirect(target, 308) : NextResponse.next();
  return applySecurityHeaders(response, requestUrl, supabaseUrl);
}
