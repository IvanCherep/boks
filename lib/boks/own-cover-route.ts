/**
 * Serves a published bok's own picture (`get_boks_cover`): the database
 * answers only for a published bok, so a draft's or a hidden bok's picture is
 * never given out. The address carries the version, so it can be cached for
 * good; an address with an old version still answers with the current one.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
}

export async function serveOwnCover(request: Request, id: string, format: "webp" | "jpeg") {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !key || !uuid.test(id)) return notFound();
  const restBase = globalThis.process?.env?.BOKS_INTERNAL_REST_URL || `${url}/rest/v1`;
  type Answer = { version?: number; bytes?: string } | null;
  let answer: Answer = null;
  try {
    const response = await fetch(`${restBase}/rpc/get_boks_cover`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ p_bok_id: id, p_format: format }),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return new Response("Unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
    answer = (await response.json()) as Answer;
  } catch {
    return new Response("Unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  if (!answer?.bytes) return notFound();
  const bytes = Buffer.from(answer.bytes, "base64");
  const asked = new URL(request.url).searchParams.get("v");
  const current = asked === String(answer.version);
  return new Response(bytes, {
    headers: {
      // The reader's picture is a JPEG when the author's browser wrote no WebP.
      "Content-Type": bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : "image/webp",
      "Content-Length": String(bytes.byteLength),
      // A versioned address is immutable; anything else is checked again soon.
      "Cache-Control": current ? "public, max-age=31536000, immutable" : "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
