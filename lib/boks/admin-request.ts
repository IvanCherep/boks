/**
 * The door of an admin-only API route: the caller must be a boks admin,
 * checked by the database with the caller's own token, so a route never
 * decides on its own who an admin is.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseApiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export function adminJsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function bearerToken(header: string | null) {
  if (!header) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  if (!match || match[1].length > 16_384) return null;
  return match[1];
}

/** Asks the database, as the caller, whether the caller is an admin. Null when it could not say. */
export async function isAdminToken(token: string, signal?: AbortSignal) {
  if (!supabaseUrl || !supabaseApiKey) return null;
  try {
    const restBase = globalThis.process?.env?.BOKS_INTERNAL_REST_URL || `${supabaseUrl}/rest/v1`;
    const response = await fetch(`${restBase}/rpc/is_boks_admin`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", apikey: supabaseApiKey, Authorization: `Bearer ${token}` },
      body: "{}",
    });
    if (response.status === 401 || response.status === 403) return false;
    if (!response.ok) return null;
    return (await response.json()) === true;
  } catch {
    return null;
  }
}

/** Null when the caller is an admin; otherwise the response to send back. */
export async function refuseUnlessAdmin(request: Request, what: string): Promise<Response | null> {
  if (!supabaseUrl || !supabaseApiKey) return adminJsonError("Supabase is not configured for this deployment.", 503);
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return adminJsonError("Sign in required.", 401);
  const admin = await isAdminToken(token, request.signal);
  if (admin === null) return adminJsonError("Could not check the session.", 502);
  if (!admin) return adminJsonError(`Only admins may use ${what}.`, 403);
  return null;
}
