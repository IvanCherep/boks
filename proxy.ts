import { NextResponse, type NextRequest } from "next/server";
import { canonicalRedirect } from "@/lib/boks/canonical-host";

/**
 * Sends the old host to tryboks.com. The rule, and why it exists, is in
 * `lib/boks/canonical-host.ts`; this file only applies it.
 *
 * 308 rather than 301: permanent, and it keeps the method, so nothing that
 * reaches here as a POST is quietly turned into a GET.
 */
export function proxy(request: NextRequest) {
  const target = canonicalRedirect(new URL(request.url), request.headers.get("host"));
  return target ? NextResponse.redirect(target, 308) : NextResponse.next();
}
