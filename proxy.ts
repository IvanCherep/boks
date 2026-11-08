import { NextResponse, type NextRequest } from "next/server";
import { canonicalRedirect } from "@/lib/boks/canonical-host";
import { applySecurityHeaders } from "@/lib/boks/security-headers";
import { authorPathTarget } from "@/lib/boks/share-link";

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
  // `/@prokhorov`, the author link the app shares, is the author page `/a/prokhorov`.
  const author = target ? null : authorPathTarget(requestUrl);
  const response = target ? NextResponse.redirect(target, 308) : author ? NextResponse.rewrite(author) : NextResponse.next();
  return applySecurityHeaders(response, requestUrl, supabaseUrl);
}
