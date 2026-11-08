// Entry point of the app container (compose.yml: `node serve.mjs`), copied next
// to the build's server.js by deploy/release.sh.
//
// It adds the two things a no-downtime release needs and the generated server
// does not have:
//
// - `GET /__health`: 200 while the process takes traffic, 503 once it has been
//   asked to stop. Caddy polls it every second and the container healthcheck
//   uses it, so a starting copy gets traffic only when it can answer, and a
//   stopping one stops getting traffic before it goes away.
// - A graceful SIGTERM: report 503, wait for Caddy to notice, stop accepting
//   connections, let the requests in flight finish, then exit. Without this,
//   Node exits on SIGTERM at once and drops whatever it was answering.
import http from "node:http";

const drainNoticeMs = 3000;   // Caddy checks health every 1 s; three checks
const finishMs = 20000;       // compose gives 30 s (stop_grace_period)

const servers = [];
let draining = false;

const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  servers.push(this);
  return listen.apply(this, args);
};

const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req, res) {
  if (event === "request" && req.url === "/__health") {
    res.writeHead(draining ? 503 : 200, { "content-type": "text/plain", "cache-control": "no-store" });
    res.end(draining ? "draining" : "ok");
    return true;
  }
  return emit.apply(this, arguments);
};

process.on("SIGTERM", () => {
  if (draining) return;
  draining = true;
  console.log(JSON.stringify({ time: new Date().toISOString(), event: "draining" }));
  setTimeout(() => {
    for (const server of servers) {
      server.close();
      server.closeIdleConnections?.();
    }
    setTimeout(() => process.exit(0), finishMs).unref();
  }, drainNoticeMs);
});

await import("./server.js");
