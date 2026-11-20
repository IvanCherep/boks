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
// It also answers the team group's commands (/stats, /server, ...): Telegram
// calls /telegram, and for each command this calls the server's one ops path,
// SITE_URL/api/ops/bot, with a key derived from RELAY_KEY (ops/bot.py --serve),
// and sends what it answers. Nothing runs between commands. /help needs no
// server; a server that does not answer is said so in the group at once.
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

// What Telegram must send with every update: derived from RELAY_KEY, so no new secret.
async function webhookSecret(env) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`telegram-webhook:${env.RELAY_KEY}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const helpText = [
  "🤖 <b>Команды бота boks</b>",
  "",
  "/stats — статистика за сегодня и вчера: люди, Россия, визиты, чтение, аккаунты, лайки, страны",
  "/stats week — неделя по дням, таблицей (или /stats 14 — любое число дней до 31)",
  "/online — сколько людей на сайте за 5 минут, 15 минут и час",
  "/server — нагрузка, память, диск, база, сервисы, ошибки, скорость сайта, релиз",
  "/help — этот список",
  "",
  "Ответ приходит в течение минуты, время — по Белграду. Команда boks в цифрах не учитывается.",
  "Если сервер в Москве недоступен, бот так и напишет.",
].join("\n");


const commandShape = /^\/(stats|stat|server|status|online|help|start)(@\w+)?(\s+[\w\u0400-\u04ff]{1,12})?\s*$/i;

// A command from the team group. Anything else - other chats, ordinary
// messages - is ignored. Telegram is answered at once; the work goes on after.
async function takeUpdate(request, env, ctx) {
  if (!sameKey(request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "", await webhookSecret(env))) {
    return new Response("Forbidden", { status: 403 });
  }
  let update;
  try { update = await request.json(); } catch { return new Response("ok"); }
  const message = update?.message;
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  if (!message || String(message.chat?.id) !== String(env.TG_CHAT) || !commandShape.test(text)) return new Response("ok");
  const command = text.split(/[\s@]/)[0].toLowerCase();
  // The list of commands needs nothing from the server: answered here, always.
  if (command === "/help" || command === "/start") {
    await telegram(env, helpText).catch(() => undefined);
    return new Response("ok");
  }
  ctx.waitUntil(askServer(env, text, command));
  return new Response("ok");
}

async function botKey(env) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`bot-call:${env.RELAY_KEY}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The server answers the command; if it cannot be reached, the group hears why.
async function askServer(env, text, command) {
  let failure = "";
  try {
    const response = await fetch(`${env.SITE_URL}/api/ops/bot`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await botKey(env)}`, "Content-Type": "application/json", "User-Agent": "boks-telegram/1 (cloudflare)" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(25_000),
    });
    if (response.ok) {
      const { reply } = await response.json();
      if (typeof reply === "string" && reply.trim()) return await telegram(env, reply);
      failure = "пустой ответ";
    } else {
      failure = `HTTP ${response.status}`;
    }
  } catch (error) {
    failure = String(error?.message ?? error).slice(0, 120);
  }
  await telegram(env, `⚠️ <b>Сервер boks в Москве сейчас недоступен для бота</b>, поэтому ${command} не выполнить.\nПричина: ${failure}. Попробуйте чуть позже; если не работает сам сайт, придёт «tryboks.com не отвечает».`).catch(() => undefined);
}

// Once, after deploying: point Telegram at /telegram and list the commands in the group.
async function setup(env, origin) {
  const api = (method, body) => fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => response.json());
  const hook = await api("setWebhook", {
    url: `${origin}/telegram`,
    secret_token: await webhookSecret(env),
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  const commands = await api("setMyCommands", {
    scope: { type: "chat", chat_id: env.TG_CHAT },
    commands: [
      { command: "stats", description: "Статистика: сегодня; /stats week — неделя" },
      { command: "online", description: "Кто на сайте сейчас" },
      { command: "server", description: "Нагрузка, память, диск, сервисы" },
      { command: "help", description: "Что умеет бот" },
    ],
  });
  return Response.json({ webhook: hook, commands });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/telegram") return takeUpdate(request, env, ctx);
    if (request.method !== "POST" || !["/send", "/setup"].includes(url.pathname)) return new Response("Not found", { status: 404 });
    const key = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!sameKey(key, env.RELAY_KEY)) return new Response("Forbidden", { status: 403 });
    if (url.pathname === "/setup") return setup(env, url.origin);
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
