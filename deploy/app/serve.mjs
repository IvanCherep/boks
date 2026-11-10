// Entry point of the app container (compose.yml: `node serve.mjs`), copied next
// to the build's server.js by deploy/release.sh.
//
// It adds what a no-downtime release needs and the generated server does not
// have:
//
// - `GET /__health`: 200 while the process takes traffic; 503 while it warms
//   up and once it has been asked to stop. Caddy polls it every second and the
//   container healthcheck uses it, so a copy gets traffic only when it can
//   answer quickly, and a stopping one stops getting traffic before it goes.
// - A warm-up before the first 200: the copy requests its own main pages (and
//   one bok page and its preview image) once, so the first readers do not pay
//   for cold code and empty caches. What those pages answered is the release's
//   self-check: `GET /__warmup` (from inside the container only) says whether
//   any of them failed, and deploy/ops/switch.sh refuses a release that did.
// - A graceful SIGTERM: report 503, wait for Caddy to notice, stop accepting
//   connections, let the requests in flight finish, then exit. Without this,
//   Node exits on SIGTERM at once and drops whatever it was answering.
import http from "node:http";

const drainNoticeMs = 5000;   // Caddy checks health every 1 s and needs two failures
const finishMs = 20000;       // compose gives 30 s (stop_grace_period)
const warmupMaxMs = 45000;    // the container healthcheck allows 60 s to start
const warmupPathMs = 15000;

const servers = [];
let listening;
const firstServer = new Promise((resolve) => (listening = resolve));
let ready = false;
let draining = false;
const warmup = { ok: null, ms: 0, pages: [] };

const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  servers.push(this);
  this.once("listening", () => listening(this));
  return listen.apply(this, args);
};

function fromInside(req) {
  const address = req.socket?.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req, res) {
  if (event === "request" && req.url === "/__health") {
    const status = draining ? "draining" : ready ? "ok" : "warming";
    res.writeHead(status === "ok" ? 200 : 503, { "content-type": "text/plain", "cache-control": "no-store" });
    res.end(status);
    return true;
  }
  if (event === "request" && req.url === "/__warmup" && fromInside(req)) {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(warmup));
    return true;
  }
  return emit.apply(this, arguments);
};

function log(event, details = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...details }));
}

async function page(base, path) {
  const started = Date.now();
  try {
    const response = await fetch(base + path, {
      headers: { "user-agent": "boks-warmup", accept: path.endsWith("/image") ? "image/*" : "text/html,*/*" },
      redirect: "manual",
      signal: AbortSignal.timeout(warmupPathMs),
    });
    await response.arrayBuffer();
    return { path, status: response.status, ms: Date.now() - started };
  } catch (error) {
    return { path, status: 0, ms: Date.now() - started, error: error instanceof Error ? error.name : "error" };
  }
}

async function warmUp() {
  const started = Date.now();
  const server = await firstServer;
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : process.env.PORT || 3000}`;
  const paths = ["/", "/series", "/api/geo"];
  const rest = process.env.BOKS_INTERNAL_REST_URL;
  if (rest) {
    try {
      const listed = await fetch(`${rest}/published_boks?select=id&limit=1`, { signal: AbortSignal.timeout(5000) });
      const [first] = listed.ok ? await listed.json() : [];
      if (first?.id) paths.push(`/b/${encodeURIComponent(first.id)}`, `/b/${encodeURIComponent(first.id)}/image`);
    } catch {
      // No database right now: the pages below show whether that matters.
    }
  }
  for (const path of paths) warmup.pages.push(await page(base, path));
  warmup.ok = warmup.pages.every((p) => p.status > 0 && p.status < 500);
  warmup.ms = Date.now() - started;
}

process.on("SIGTERM", () => {
  if (draining) return;
  draining = true;
  log("draining");
  setTimeout(() => {
    let open = servers.length;
    const closed = () => {
      open -= 1;
      if (open <= 0) process.exit(0);
    };
    for (const server of servers) {
      server.close(closed);
      server.closeIdleConnections?.();
    }
    // Keep-alive connections from Caddy become idle as their last answer ends.
    setInterval(() => servers.forEach((server) => server.closeIdleConnections?.()), 250).unref();
    setTimeout(() => process.exit(0), finishMs).unref();
  }, drainNoticeMs);
});

await import("./server.js");

// Traffic only after the warm-up, but never later than warmupMaxMs: a slow
// database must not keep a restarted copy out of service for good.
const limit = new Promise((resolve) => setTimeout(resolve, warmupMaxMs).unref());
await Promise.race([warmUp().catch(() => undefined), limit]);
if (warmup.ok === null) warmup.ok = false;
ready = true;
log("ready", { warmup: warmup.ok, ms: warmup.ms, pages: warmup.pages.map((p) => `${p.path} ${p.status} ${p.ms}ms`) });
