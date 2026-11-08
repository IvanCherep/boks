// boks-telegram: a Cloudflare Worker between our server and Telegram.
//
// Telegram's API is not reachable from the server in Russia; Cloudflare is.
// The server POSTs a message here with a shared key, and the Worker sends it
// to one fixed chat (the team group). It is not a general Telegram proxy:
// the chat and the bot token live only in this Worker's secrets.
//
// It also watches the site from outside every five minutes, because a server
// that is down cannot report itself. State lives in KV and is written only
// when it changes, so the free plan's limits are never close.
//
// Secrets: TG_TOKEN, TG_CHAT, RELAY_KEY. Vars: SITE_URL. KV: STATE.

const failuresBeforeAlert = 2;

async function telegram(env, text, silent = false) {
  const response = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TG_CHAT,
      text: text.slice(0, 4000),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      disable_notification: silent,
    }),
  });
  if (!response.ok) throw new Error(`Telegram ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

function sameKey(given, expected) {
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function checkSite(env) {
  const started = Date.now();
  try {
    const response = await fetch(`${env.SITE_URL}/api/geo`, {
      headers: { "User-Agent": "boks-uptime/1 (cloudflare)" },
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: response.status === 200, detail: `HTTP ${response.status}`, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, detail: String(error?.message ?? error).slice(0, 120), ms: Date.now() - started };
  }
}

async function watch(env) {
  const state = JSON.parse((await env.STATE.get("uptime")) ?? '{"down":false,"failures":0}');
  const result = await checkSite(env);
  if (result.ok) {
    if (state.down) {
      const minutes = Math.round((Date.now() - state.since) / 60000);
      await telegram(env, `✅ <b>tryboks.com снова отвечает</b>\nНе работал примерно ${minutes} мин. Ответ за ${result.ms} мс.`);
    }
    if (state.down || state.failures) await env.STATE.put("uptime", JSON.stringify({ down: false, failures: 0 }));
    return;
  }
  const failures = (state.failures ?? 0) + 1;
  if (!state.down && failures >= failuresBeforeAlert) {
    await telegram(env, `🔴 <b>tryboks.com не отвечает</b>\nПроверка из Cloudflare, ${failures} раза подряд: ${result.detail}`);
    await env.STATE.put("uptime", JSON.stringify({ down: true, failures, since: Date.now() }));
  } else if (!state.down) {
    await env.STATE.put("uptime", JSON.stringify({ down: false, failures }));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/send") return new Response("Not found", { status: 404 });
    const key = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!sameKey(key, env.RELAY_KEY)) return new Response("Forbidden", { status: 403 });
    let body;
    try { body = await request.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
    if (typeof body.text !== "string" || !body.text.trim()) return new Response("Empty text", { status: 400 });
    try {
      await telegram(env, body.text, Boolean(body.silent));
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json({ ok: false, error: String(error?.message ?? error) }, { status: 502 });
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(watch(env));
  },
};
