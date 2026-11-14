import {
  isSameOrigin,
  isSecureRequest,
  keptSessionClearCookie,
  keptSessionSetCookie,
  readKeptSession,
} from "@/lib/boks/session-keeper";

/**
 * A fresh session for a reader whose browser forgot theirs: the kept refresh
 * token (`/api/session`) is traded with GoTrue for a new one, which is kept
 * in its place and handed to the page. A token GoTrue refuses (signed out
 * elsewhere, account deleted) clears the cookie.
 */
export const dynamic = "force-dynamic";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403, headers: noStore });
  const token = readKeptSession(request.headers.get("cookie"));
  if (!token) return Response.json({ session: null }, { headers: noStore });

  // On our server the app reaches GoTrue over the private network.
  const authBase = globalThis.process?.env?.BOKS_INTERNAL_AUTH_URL || (supabaseUrl ? `${supabaseUrl}/auth/v1` : null);
  if (!authBase) return Response.json({ session: null }, { headers: noStore });

  let answer: Response;
  try {
    answer = await fetch(`${authBase}/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(publishableKey ? { apikey: publishableKey } : {}),
        // GoTrue limits refreshes per address: count the reader's, not the app's.
        ...(request.headers.get("x-forwarded-for") ? { "X-Forwarded-For": request.headers.get("x-forwarded-for") as string } : {}),
      },
      body: JSON.stringify({ refresh_token: token }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Unreachable for now: keep the cookie, try again on the next visit.
    return Response.json({ session: null }, { headers: noStore });
  }

  const secure = isSecureRequest(request);
  if (answer.status >= 400 && answer.status < 500) {
    return Response.json({ session: null }, { headers: { ...noStore, "Set-Cookie": keptSessionClearCookie(secure) } });
  }
  if (!answer.ok) return Response.json({ session: null }, { headers: noStore });

  const session = (await answer.json()) as { access_token?: string; refresh_token?: string; user?: { is_anonymous?: boolean } };
  if (!session.access_token || !session.refresh_token || session.user?.is_anonymous) {
    return Response.json({ session: null }, { headers: { ...noStore, "Set-Cookie": keptSessionClearCookie(secure) } });
  }
  return Response.json(
    { session: { access_token: session.access_token, refresh_token: session.refresh_token } },
    { headers: { ...noStore, "Set-Cookie": keptSessionSetCookie(session.refresh_token, secure) } }
  );
}
