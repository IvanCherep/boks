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
// It also takes the team group's commands (/stats, /server, ...): Telegram
// calls /telegram, the command waits in KV, and the server collects it every
// minute from /pending (ops/bot.py) and answers through /send. The server is
// never called from here, and only the team group is listened to.
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

// How long the server may take to collect a command before the group is told it did not.
const collectWithinMs = 2 * 60_000;

const commandShape = /^\/(stats|stat|server|status|online|help|start)(@\w+)?(\s+[\w\u0400-\u04ff]{1,12})?\s*$/i;
const queueLimit = 10;

// A command from the team group, kept until the server collects it. Anything
// else - other chats, ordinary messages - is ignored, and KV is written only
// for a command.
async function takeUpdate(request, env) {
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
  // The server cannot be reached from here: say so now instead of leaving the question hanging.
  const site = await checkSite(env);
  if (!site.ok) {
    await telegram(env, `⚠️ <b>Сервер boks в Москве сейчас недоступен</b>, поэтому ${command} не выполнить.\nПроверка из Cloudflare: ${site.detail}. Когда сайт снова ответит, придёт «tryboks.com снова отвечает».`).catch(() => undefined);
    return new Response("ok");
  }
  const queue = JSON.parse((await env.STATE.get("commands")) ?? "[]");
  if (queue.length < queueLimit) {
    queue.push({ text, at: Date.now() });
    await env.STATE.put("commands", JSON.stringify(queue));
  }
  return new Response("ok");
}

// Commands the server has not collected in time: the link from Moscow to
// Cloudflare is down while the site itself answers. Told once, then dropped.
async function overdue(env) {
  const raw = await env.STATE.get("commands");
  if (!raw || raw === "[]") return;
  const queue = JSON.parse(raw);
  const late = queue.filter((item) => Date.now() - item.at >= collectWithinMs);
  if (!late.length) return;
  await env.STATE.put("commands", JSON.stringify(queue.filter((item) => Date.now() - item.at < collectWithinMs)));
  const names = [...new Set(late.map((item) => item.text.split(/[\s@]/)[0]))].join(", ");
  await telegram(env, `⚠️ <b>Сервер boks не забрал команду</b> ${names} за 2 минуты: связь между сервером в Москве и Cloudflare, похоже, прервалась. Сайт снаружи при этом отвечает. Попробуйте чуть позже.`, true);
}

// The server's minute: the waiting commands, handed over once.
async function handOver(env) {
  const raw = await env.STATE.get("commands");
  if (!raw || raw === "[]") return Response.json({ commands: [] });
  await env.STATE.put("commands", "[]");
  // Older than ten minutes is a question nobody is waiting for any more.
  const fresh = JSON.parse(raw).filter((item) => Date.now() - item.at < 10 * 60_000);
  return Response.json({ commands: fresh });
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
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/telegram") return takeUpdate(request, env);
    if (request.method !== "POST" || !["/send", "/pending", "/setup"].includes(url.pathname)) return new Response("Not found", { status: 404 });
    const key = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!sameKey(key, env.RELAY_KEY)) return new Response("Forbidden", { status: 403 });
    if (url.pathname === "/pending") return handOver(env);
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

  // Every minute: overdue commands; every fifth minute also the uptime check, as before.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(overdue(env));
    if (new Date(event.scheduledTime).getUTCMinutes() % 5 === 0) ctx.waitUntil(watch(env));
  },
};
