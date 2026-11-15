// boks-elevenlabs: a Cloudflare Worker between the Series worker and ElevenLabs.
//
// ElevenLabs answers POSTs from our server in Russia with an "Access
// restricted" page; from Cloudflare it answers normally. The Series worker
// (scripts/series-worker.mts) sends its two calls here with a shared key, and
// the Worker passes them on unchanged, streaming both ways. It is not a
// general proxy: only the two paths the recorder uses, only with the key.
// The ElevenLabs key itself stays on the server and travels in xi-api-key.
//
// Secret: RELAY_KEY.

const paths = new Set(["/v1/forced-alignment", "/v1/speech-to-text"]);

function sameKey(given, expected) {
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || !paths.has(url.pathname)) return new Response("Not found", { status: 404 });
    if (!sameKey(request.headers.get("X-Boks-Relay") ?? "", env.RELAY_KEY)) return new Response("Forbidden", { status: 403 });
    const headers = new Headers();
    for (const name of ["xi-api-key", "content-type"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    return fetch(`https://api.elevenlabs.io${url.pathname}${url.search}`, { method: "POST", headers, body: request.body });
  },
};
