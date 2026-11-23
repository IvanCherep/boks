/**
 * «О проекте»: the team's one-page story (mission, story, team, a panorama of
 * authors and Series covers), at /about, linked from «О boks» in settings and
 * from the letter to authors.
 *
 * The page is a self-contained HTML file (fonts and pictures inline, no
 * scripts) that is not in this repository: it carries living authors' covers
 * and the repository is public (`docs/link-only-pieces.md`). It lives on the
 * server in the link-only store, `/opt/boks/link-only/site/boks-o-proekte.html`,
 * and is read through Caddy's internal port like the link-only pieces. To
 * replace it, copy a new file over that one; no release is needed.
 */
const file = "site/boks-o-proekte.html";

function plain(status: number, text: string) {
  return new Response(text, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const base = process.env.BOKS_LINK_ONLY_BASE_URL;
  if (!base) return plain(404, "Not found");

  let upstream: Response;
  try {
    upstream = await fetch(`${base.replace(/\/+$/, "")}/${file}`, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return plain(502, "Unavailable");
  }
  if (upstream.status === 404) return plain(404, "Not found");
  if (!upstream.ok) return plain(502, "Unavailable");

  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=600",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of ["Content-Length", "ETag", "Last-Modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: 200, headers });
}
