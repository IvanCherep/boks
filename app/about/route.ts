/**
 * «О проекте»: the team's one-page PDF (mission, story, team, Series covers),
 * shown in the browser at /about and linked from the letter to authors.
 *
 * The file is not in this repository: it carries living authors' covers and
 * the repository is public (`docs/link-only-pieces.md`). It lives on the
 * server in the link-only store, `/opt/boks/link-only/site/boks-mission.pdf`,
 * and is read through Caddy's internal port like the link-only pieces. To
 * replace it, copy a new file over that one; no release is needed.
 */
const file = "site/boks-mission.pdf";

function plain(status: number, text: string) {
  return new Response(text, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const base = process.env.BOKS_LINK_ONLY_BASE_URL;
  if (!base) return plain(404, "Not found");

  const range = request.headers.get("Range");
  let upstream: Response;
  try {
    upstream = await fetch(`${base.replace(/\/+$/, "")}/${file}`, {
      headers: range ? { Range: range } : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return plain(502, "Unavailable");
  }
  if (upstream.status === 404) return plain(404, "Not found");
  if (!upstream.ok) return plain(502, "Unavailable");

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": 'inline; filename="boks-o-proekte.pdf"',
    "Cache-Control": "public, max-age=600",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  });
  for (const name of ["Content-Length", "Content-Range", "ETag", "Last-Modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
