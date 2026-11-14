import {
  isPlausibleRefreshToken,
  isSameOrigin,
  isSecureRequest,
  keptSessionClearCookie,
  keptSessionSetCookie,
} from "@/lib/boks/session-keeper";

/**
 * Keep the signed-in reader's refresh token in an HttpOnly cookie, so the
 * session survives a browser that empties localStorage
 * (`lib/boks/session-keeper.ts`). POST keeps it, DELETE forgets it (sign-out).
 * Nothing is stored on the server; the token is not logged.
 */
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403, headers: noStore });
  let token: unknown = null;
  try {
    token = ((await request.json()) as { refreshToken?: unknown })?.refreshToken;
  } catch {
    token = null;
  }
  if (!isPlausibleRefreshToken(token)) return new Response(null, { status: 400, headers: noStore });
  return new Response(null, {
    status: 204,
    headers: { ...noStore, "Set-Cookie": keptSessionSetCookie(token, isSecureRequest(request)) },
  });
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403, headers: noStore });
  return new Response(null, {
    status: 204,
    headers: { ...noStore, "Set-Cookie": keptSessionClearCookie(isSecureRequest(request)) },
  });
}
