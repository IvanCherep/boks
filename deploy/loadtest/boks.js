// boks load test v2: open model calibrated on production sessions (45 days, 940 sessions).
// Visitors ARRIVE at a fixed rate (RATE per minute); each runs one session of a
// sampled length and leaves. Concurrency = arrival rate x mean session (Little's law).
// Every request a real first-time guest makes is reproduced (captured from a real browser).
// Env: RATE (arrivals/min), DURATION (e.g. 8m), CAP (max session seconds, default 600),
//      SERIES_SHARE (share of sessions on the series shelf, default 0.1), SPIKE=1 for a burst.
import http from "k6/http";
import { sleep, check } from "k6";
import { SharedArray } from "k6/data";
import { Trend, Counter } from "k6/metrics";
import crypto from "k6/crypto";
import encoding from "k6/encoding";

const BASE = "https://tryboks.ru";
const ANON = __ENV.ANON_KEY;
const SRK = __ENV.SERVICE_ROLE_KEY;
const JWT_SECRET = __ENV.JWT_SECRET;
const RATE = Number(__ENV.RATE || 60);
const DURATION = __ENV.DURATION || "8m";
const CAP = Number(__ENV.CAP || 600);
const SERIES_SHARE = Number(__ENV.SERIES_SHARE || 0.1);
const pieces = new SharedArray("pieces", () => JSON.parse(open("./series.json")));
const covers = new SharedArray("covers", () => JSON.parse(open("./covers.json")));
const hasCover = {}; for (const c of covers) hasCover[c] = true;

// Real session length quantiles (seconds) at 0,10..90,95,99,100%.
const sessionQ = [[0, 0], [0.1, 0], [0.2, 0.8], [0.3, 2.6], [0.4, 3], [0.5, 11], [0.6, 38], [0.7, 108],
                  [0.8, 422], [0.9, 1868], [0.95, 7424], [0.99, 59453], [1, 59453]];
// Real seconds from "start" to "complete/skip" for one bok.
const bokQ = [[0, 3], [0.25, 10], [0.5, 40], [0.75, 151], [0.95, 600], [1, 900]];
function sample(q) {
  const u = Math.random();
  for (let i = 1; i < q.length; i++) if (u <= q[i][0]) {
    const [u0, v0] = q[i - 1], [u1, v1] = q[i];
    return v0 + (v1 - v0) * (u - u0) / Math.max(u1 - u0, 1e-9);
  }
  return q[q.length - 1][1];
}

const T = {}; const E = {};
for (const n of ["page", "static", "signup", "feed", "likes", "ctx", "geo", "journey", "events", "image", "media"]) {
  T[n] = new Trend(`t_${n}`, true); E[n] = new Counter(`err_${n}`);
}
const busy = new Counter("busy_pages");

export const options = {
  scenarios: __ENV.SPIKE ? {
    spike: { executor: "per-vu-iterations", vus: Number(__ENV.SPIKE_N || 300), iterations: 1, maxDuration: "15m" },
  } : {
    open: { executor: "constant-arrival-rate", rate: RATE, timeUnit: "1m", duration: DURATION,
            preAllocatedVUs: Math.ceil(RATE * 3), maxVUs: Math.ceil(RATE * 14) },
  },
  thresholds: { http_req_failed: [{ threshold: "rate<0.2", abortOnFail: true, delayAbortEval: "60s" }] },
  summaryTrendStats: ["med", "p(95)", "max"],
  userAgent: "boks-loadtest/2 (k6)",
};

export function setup() {
  const html = http.get(`${BASE}/`).body || "";
  const assets = [...new Set((html.match(/(?:src|href)="(\/_next\/static\/[^"]+)"/g) || [])
    .map((m) => m.replace(/^(?:src|href)="/, "").replace(/"$/, "")))];
  // Fonts are referenced from the CSS.
  for (const css of assets.filter((a) => a.endsWith(".css"))) {
    const body = http.get(`${BASE}${css}`).body || "";
    for (const m of body.match(/\/_next\/static\/media\/[^)"']+\.woff2/g) || []) if (!assets.includes(m)) assets.push(m);
  }
  assets.push("/manifest.webmanifest", "/icon-192.png");
  return { assets: assets.slice(0, 40) };
}

const ENC = { "Accept-Encoding": "br, gzip" };
function req(name, method, url, body, headers) {
  const r = http.request(method, url, body, { headers: Object.assign({}, ENC, headers || {}), tags: { name }, timeout: "30s" });
  T[name].add(r.timings.duration);
  if (r.status === 0 || r.status >= 400) E[name].add(1);
  return r;
}
function api(s) { return { apikey: ANON, Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" }; }

function events(s, bok, types, extra) {
  const list = types.map((t) => Object.assign({
    storyId: bok.id, eventType: t, visitorId: s.visitor, sessionId: s.session, algorithmId: s.exp.algorithmId,
    experimentKey: s.exp.experimentKey, userSegment: s.exp.userSegment, surface: "reader", rank: bok.rank,
    feedId: s.feedId, servingBackend: "worker" }, extra || {}));
  req("events", "POST", `${BASE}/rest/v1/rpc/record_recommendation_events`, JSON.stringify({ p_events: list }), api(s));
}

function feed(s) {
  const r = req("feed", "POST", `${BASE}/api/feed`, JSON.stringify({ limit: 30, sessionId: s.session,
    readingLanguages: [s.lang], reader: {} }), api(s));
  if (r.status !== 200) return false;
  const d = r.json(); s.feedId = d.feedId; s.exp = d.experiment || {};
  s.slate = (d.entries || []).map((e) => ({ id: e.reelId, rank: e.rank })); s.pos = 0;
  return true;
}

export default function (data) {
  const s = { session: `loadtest-${__VU}-${__ITER}-${Date.now()}`, lang: Math.random() < 0.6 ? "ru" : "en", exp: {} };
  s.visitor = s.session;
  const started = Date.now();
  const length = Math.min(sample(sessionQ), CAP) * 1000;
  const series = Math.random() < SERIES_SHARE;

  // 1. Page and everything a first visit downloads.
  const page = req("page", "GET", `${BASE}${series ? "/series" : "/"}`);
  if (page.status === 503) busy.add(1);
  if (page.status !== 200) return;          // waiting page: a real visitor would wait there
  http.batch(data.assets.map((a) => ["GET", `${BASE}${a}`, null, { headers: ENC, tags: { name: "static" } }]))
    .forEach((r) => { T.static.add(r.timings.duration); if (r.status >= 400 || r.status === 0) E.static.add(1); });

  // 2. A new guest gets an account row. Production limits anonymous sign-ups per IP
  // (300/h), which one load generator would hit, so the row is created through the
  // auth admin API (the same insert into auth.users) and the token is signed with
  // the same secret GoTrue uses, marked anonymous like a real guest's.
  const su = req("signup", "POST", `${BASE}/auth/v1/admin/users`, JSON.stringify({
    email: `${s.session}@loadtest.tryboks.ru`, email_confirm: true, user_metadata: { loadtest: true } }),
    { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" });
  if (su.status !== 200) return;
  s.user = su.json().id;
  const now = Math.floor(Date.now() / 1000);
  const h = encoding.b64encode(JSON.stringify({ alg: "HS256", typ: "JWT" }), "rawurl");
  const p = encoding.b64encode(JSON.stringify({ sub: s.user, aud: "authenticated", role: "authenticated",
    iat: now, exp: now + 7200, is_anonymous: true, iss: `${BASE}/auth/v1` }), "rawurl");
  s.token = `${h}.${p}.${crypto.hmac("sha256", JWT_SECRET, `${h}.${p}`, "base64rawurl")}`;

  // 3. Feed and what the reader asks for right after it.
  if (!feed(s)) return;
  const ids = s.slate.map((b) => b.id).join(",");
  req("likes", "GET", `${BASE}/rest/v1/likes?select=reel_id&user_id=eq.${s.user}&reel_id=in.(${ids})`, null, api(s));
  req("ctx", "POST", `${BASE}/rest/v1/rpc/get_boks_user_context`, "{}", api(s));
  req("geo", "GET", `${BASE}/api/geo`);
  req("journey", "POST", `${BASE}/rest/v1/rpc/record_boks_journey_event`, JSON.stringify({ p_event: "visit",
    p_visitor_id: s.visitor, p_session_id: s.session, p_reason: null, p_landing: series ? "series" : "feed",
    p_referrer_host: null, p_utm_source: null, p_utm_medium: null, p_utm_campaign: null, p_country: "RU",
    p_landing_bok: null, p_link_code: null }), api(s));
  for (const p of ["reaction-smiled-v44", "reaction-moved-v44", "reaction-surprised-v44", "reaction-pondering-v44"])
    req("image", "GET", `${BASE}/design/${p}.png`);

  // 4a. Series listener: a piece's manifest, sound and pictures, then listening.
  if (series) {
    while (Date.now() - started < length) {
      const piece = pieces[Math.floor(Math.random() * pieces.length)];
      for (const f of [`/poetry/${piece.slug}/manifest.json`, ...piece.audio, ...piece.images]) {
        const r = req("media", "GET", `${BASE}${f}`);
      }
      const bok = s.slate[0] || { id: null, rank: 0 };
      if (bok.id) events(s, bok, ["impression", "start"]);
      sleep(Math.min(90, Math.max(5, (length - (Date.now() - started)) / 1000)));
      if (bok.id) events(s, bok, ["heartbeat"], { activeSeconds: 60, progress: 0.7 });
    }
    return;
  }

  // 4b. Reader: one bok after another until the session ends.
  let read = 0;
  while (true) {
    if (s.pos >= s.slate.length || read >= 25) { if (!feed(s)) return; read = 0; }
    const bok = s.slate[s.pos++];
    if (hasCover[bok.id]) req("image", "GET", `${BASE}/covers/${bok.id}.webp`);  // only boks that have artwork
    events(s, bok, ["impression", "start", "touch"]);
    let left = sample(bokQ);
    let active = 0;
    while (left > 0) {                      // a heartbeat per minute of reading
      const step = Math.min(60, left);
      const remaining = length - (Date.now() - started);
      if (remaining <= 0) return;           // the reader leaves mid-bok
      sleep(Math.min(step, remaining / 1000));
      left -= step; active += step;
      if (step === 60 && left > 0) events(s, bok, ["heartbeat"], { activeSeconds: active, progress: 0.5 });
    }
    const done = Math.random() < 0.08;      // production: 81 reads to 992 skips
    events(s, bok, [done ? "complete" : "skip"], { activeSeconds: active, progress: done ? 1 : 0.2, value: active });
    read++;
    if (Date.now() - started >= length) return;
    sleep(1 + Math.random() * 2);
  }
}

export function handleSummary(d) {
  const v = (k, s) => (d.metrics[k] ? Math.round(d.metrics[k].values[s] || 0) : null);
  const out = { rate_per_min: RATE, spike: __ENV.SPIKE ? Number(__ENV.SPIKE_N || 300) : 0,
    sessions: v("iterations", "count"), vus_max: v("vus", "max"),
    rps: d.metrics.http_reqs ? +d.metrics.http_reqs.values.rate.toFixed(1) : 0,
    failed_pct: d.metrics.http_req_failed ? +(d.metrics.http_req_failed.values.rate * 100).toFixed(2) : 0,
    busy_pages: v("busy_pages", "count") || 0 };
  for (const n of ["page", "signup", "feed", "likes", "ctx", "journey", "events", "image", "media"])
    if (d.metrics[`t_${n}`]) out[n] = `${v(`t_${n}`, "med")}/${v(`t_${n}`, "p(95)")}ms err${v(`err_${n}`, "count") || 0}`;
  return { stdout: JSON.stringify(out) + "\n" };
}
