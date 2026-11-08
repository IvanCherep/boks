// boks series load test: N listeners on the series shelf at the same time (closed model).
// Each listener does exactly what a browser did on 2026-11-08 (captured): /series page and
// its assets, guest account, feed, shelf titles (published_boks), shelf covers, context,
// geo, journey; then piece after piece: bok text, reactions, manifest, all scenes, narration
// and theme (whole mp3), view, start event, listening for the piece's real duration, complete.
// Env: VUS (listeners), HOLD (e.g. 4m), BASE (default https://tryboks.ru), keys as in boks.js.
import http from "k6/http";
import { sleep } from "k6";
import { SharedArray } from "k6/data";
import { Trend, Counter } from "k6/metrics";
import crypto from "k6/crypto";
import encoding from "k6/encoding";

const BASE = __ENV.BASE || "https://tryboks.ru";
const HOST = __ENV.HOST || "";            // Host header when BASE is an IP (server-local run)
const ANON = __ENV.ANON_KEY, SRK = __ENV.SERVICE_ROLE_KEY, JWT_SECRET = __ENV.JWT_SECRET;
const VUS = Number(__ENV.VUS || 50);
const pieces = new SharedArray("pieces", () => JSON.parse(open("./series-full.json")));
const shelf = new SharedArray("shelf", () => JSON.parse(open("./shelf.json")));

const T = {}, E = {};
for (const n of ["page", "signup", "feed", "api", "media_small", "audio", "piece_ready"]) {
  T[n] = new Trend(`t_${n}`, true); E[n] = new Counter(`err_${n}`);
}
const bytes = new Counter("media_bytes");
const piecesPlayed = new Counter("pieces_played");
const stalls = new Counter("stalls");      // piece took longer to download than 5 s

export const options = {
  scenarios: { listen: { executor: "ramping-vus", startVUs: 0, gracefulRampDown: "20s",
    stages: [{ duration: __ENV.RAMP || "60s", target: VUS }, { duration: __ENV.HOLD || "4m", target: VUS }] } },
  thresholds: { http_req_failed: [{ threshold: "rate<0.2", abortOnFail: true, delayAbortEval: "60s" }] },
  summaryTrendStats: ["med", "p(95)", "max"],
  userAgent: "boks-loadtest/series (k6)",
  insecureSkipTLSVerify: !!HOST,
};

const ENC = { "Accept-Encoding": "br, gzip" };
function hdr(extra) { const h = Object.assign({}, ENC, extra || {}); if (HOST) h.Host = HOST; return h; }
function req(name, method, path, body, headers) {
  const r = http.request(method, `${BASE}${path}`, body, { headers: hdr(headers), tags: { name }, timeout: "60s" });
  T[name].add(r.timings.duration);
  if (r.status === 0 || r.status >= 400) E[name].add(1);
  if (r.body) bytes.add(r.body.length);
  return r;
}

export function setup() {
  const html = http.get(`${BASE}/series`, { headers: hdr() }).body || "";
  const assets = [...new Set((html.match(/(?:src|href)="(\/_next\/static\/[^"]+)"/g) || [])
    .map((m) => m.replace(/^(?:src|href)="/, "").replace(/"$/, "")))];
  for (const css of assets.filter((a) => a.endsWith(".css"))) {
    const body = http.get(`${BASE}${css}`, { headers: hdr() }).body || "";
    for (const m of body.match(/\/_next\/static\/media\/[^)"']+\.woff2/g) || []) if (!assets.includes(m)) assets.push(m);
  }
  return { assets: assets.concat(["/manifest.webmanifest", "/icon-192.png"]) };
}

const st = {};
function api(extra) { return Object.assign({ apikey: ANON, Authorization: `Bearer ${st.token}`, "Content-Type": "application/json" }, extra || {}); }

function arrive(data) {
  st.session = `loadtest-s${__VU}-${Date.now()}`;
  req("page", "GET", "/series");
  http.batch(data.assets.map((a) => ["GET", `${BASE}${a}`, null, { headers: hdr(), tags: { name: "static" } }]));
  const su = req("signup", "POST", "/auth/v1/admin/users", JSON.stringify({ email: `${st.session}@loadtest.tryboks.ru`,
    email_confirm: true, user_metadata: { loadtest: true } }), { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" });
  if (su.status !== 200) return false;
  st.user = su.json().id;
  const now = Math.floor(Date.now() / 1000);
  const h = encoding.b64encode(JSON.stringify({ alg: "HS256", typ: "JWT" }), "rawurl");
  const p = encoding.b64encode(JSON.stringify({ sub: st.user, aud: "authenticated", role: "authenticated",
    iat: now, exp: now + 7200, is_anonymous: true, iss: "https://tryboks.ru/auth/v1" }), "rawurl");
  st.token = `${h}.${p}.${crypto.hmac("sha256", JWT_SECRET, `${h}.${p}`, "base64rawurl")}`;
  const f = req("feed", "POST", "/api/feed", JSON.stringify({ limit: 30, sessionId: st.session, readingLanguages: ["ru"], reader: {}, profileSnapshot: {} }), api());
  if (f.status !== 200) return false;
  const d = f.json(); st.exp = d.experiment || {}; st.feedId = d.feedId;
  st.ids = (d.entries || []).map((e) => e.reelId);
  const list = st.ids.join(",");
  req("api", "GET", `/rest/v1/published_boks?select=id%2Ctitle%2Cauthor_name&id=in.(${list})`, null, api());
  for (const slug of shelf.slice(0, 9)) req("media_small", "GET", `/series/${slug}.webp`);
  req("api", "GET", `/rest/v1/likes?select=reel_id&user_id=eq.${st.user}&reel_id=in.(${list})`, null, api());
  req("api", "POST", "/rest/v1/rpc/get_boks_user_context", "{}", api());
  req("api", "GET", "/api/geo");
  req("api", "POST", "/rest/v1/rpc/record_boks_journey_event", JSON.stringify({ p_event: "visit", p_visitor_id: st.session,
    p_session_id: st.session, p_reason: null, p_landing: "series", p_referrer_host: null, p_utm_source: null, p_utm_medium: null,
    p_utm_campaign: null, p_country: "RU", p_landing_bok: null, p_link_code: null }), api());
  for (const r of ["smiled", "moved", "surprised", "pondering"]) req("media_small", "GET", `/design/reaction-${r}-v44.png`);
  return true;
}

function events(id, types, extra) {
  req("api", "POST", "/rest/v1/rpc/record_recommendation_events", JSON.stringify({ p_events: types.map((t) => Object.assign({
    storyId: id, eventType: t, visitorId: st.session, sessionId: st.session, algorithmId: st.exp.algorithmId,
    experimentKey: st.exp.experimentKey, userSegment: st.exp.userSegment, surface: "series", rank: 0,
    feedId: st.feedId, servingBackend: "worker" }, extra || {})) }), api());
}

export default function (data) {
  if (!st.token && !arrive(data)) { sleep(5); return; }
  const piece = pieces[Math.floor(Math.random() * pieces.length)];
  const id = st.ids[Math.floor(Math.random() * st.ids.length)];
  const t0 = Date.now();
  req("api", "GET", `/rest/v1/published_boks?select=id%2Ctitle%2Cauthor_name%2Ctext%2Clanguage%2Csummary&id=eq.${id}`, null, api());
  req("api", "POST", "/rest/v1/rpc/get_bok_reactions", JSON.stringify({ p_reel_ids: [id] }), api());
  const reqs = piece.files.map((f) => ["GET", `${BASE}${f}`, null,
    { headers: hdr(), tags: { name: f.endsWith(".mp3") ? "audio" : "media_small" }, timeout: "120s" }]);
  for (const r of http.batch(reqs)) {               // a browser fetches the piece's files in parallel
    const kind = r.url.endsWith(".mp3") ? "audio" : "media_small";
    T[kind].add(r.timings.duration);
    if (r.status === 0 || r.status >= 400) E[kind].add(1);
    if (r.body) bytes.add(r.body.length);
  }
  const ready = Date.now() - t0;
  T.piece_ready.add(ready);
  if (ready > 5000) stalls.add(1);
  req("api", "POST", "/rest/v1/views", JSON.stringify({ user_id: st.user, reel_id: id }), api({ Prefer: "return=minimal" }));
  events(id, ["impression", "start"]);
  sleep(Math.max(1, piece.seconds - ready / 1000));   // listening
  events(id, ["complete"], { activeSeconds: piece.seconds, progress: 1, value: piece.seconds });
  piecesPlayed.add(1);
  sleep(3 + Math.random() * 5);                        // choosing the next piece
}

export function handleSummary(d) {
  const v = (k, s) => (d.metrics[k] ? Math.round(d.metrics[k].values[s] || 0) : null);
  const secs = d.state.testRunDurationMs / 1000;
  const out = { listeners: VUS, pieces: v("pieces_played", "count"), stalls_gt5s: v("stalls", "count") || 0,
    failed_pct: d.metrics.http_req_failed ? +(d.metrics.http_req_failed.values.rate * 100).toFixed(2) : 0,
    mbit_s: d.metrics.media_bytes ? +(d.metrics.media_bytes.values.count * 8 / secs / 1e6).toFixed(1) : 0 };
  for (const n of ["page", "feed", "api", "media_small", "audio", "piece_ready"])
    if (d.metrics[`t_${n}`]) out[n] = `${v(`t_${n}`, "med")}/${v(`t_${n}`, "p(95)")}ms err${v(`err_${n}`, "count") || 0}`;
  return { stdout: JSON.stringify(out) + "\n" };
}
