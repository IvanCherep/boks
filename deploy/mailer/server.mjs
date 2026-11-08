// boks auth mailer: GoTrue's "send email" hook.
//
// GoTrue calls POST /send for every auth email (sign-in code, confirmation).
// We render the project's templates (supabase/templates) and send through the
// Resend API from the primary sender (hello@tryboks.com). If Resend refuses or
// does not answer, we immediately retry from the fallback sender
// (hello@tryboks.ru). Delivery problems that surface later (spam, bounce) are
// not visible here; they show up in the Resend logs.
//
// Requests are signed by GoTrue (Standard Webhooks); anything unsigned is refused.
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

const {
  RESEND_API_KEY,
  HOOK_SECRET, // "v1,whsec_<base64>", the same value GoTrue has
  AUTH_PUBLIC_URL = "https://tryboks.com/auth/v1",
  FROM_PRIMARY = "boks <hello@tryboks.com>",
  FROM_FALLBACK = "boks <hello@tryboks.ru>",
  REPLY_TO = "support@tryboks.com",
  TEMPLATES_DIR = "/templates",
  PORT = "8090",
} = process.env;

if (!RESEND_API_KEY || !HOOK_SECRET) throw new Error("RESEND_API_KEY and HOOK_SECRET are required");
const hookKey = Buffer.from(HOOK_SECRET.replace(/^v1,whsec_/, ""), "base64");

// GoTrue gives the hook about five seconds; two attempts must fit in it.
const attemptTimeoutMs = 2200;
const subject = "Ваш код для входа в boks";

const templates = {
  magiclink: await readFile(`${TEMPLATES_DIR}/magic-link.html`, "utf8"),
  signup: await readFile(`${TEMPLATES_DIR}/confirmation.html`, "utf8"),
};

function verify(headers, body) {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatures = String(headers["webhook-signature"] ?? "").split(" ");
  if (!id || !timestamp) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", hookKey).update(`${id}.${timestamp}.${body}`).digest();
  return signatures.some((entry) => {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

function render(type, data) {
  const template = templates[type] ?? templates.magiclink;
  const link = `${AUTH_PUBLIC_URL}/verify?token=${encodeURIComponent(data.token_hash)}&type=${encodeURIComponent(type)}&redirect_to=${encodeURIComponent(data.redirect_to ?? "")}`;
  const html = template.replaceAll("{{ .Token }}", data.token ?? "").replaceAll("{{ .ConfirmationURL }}", link);
  const text = `Ваш код для входа в boks: ${data.token}\n\nИли откройте ссылку: ${link}\n\nКод действует один час.`;
  return { html, text };
}

async function sendVia(from, to, message) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], reply_to: REPLY_TO, subject, ...message }),
    signal: AbortSignal.timeout(attemptTimeoutMs),
  });
  if (!response.ok) throw new Error(`Resend ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return (await response.json()).id;
}

function log(event, fields) {
  // No codes, links or full addresses in logs.
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}

const maskEmail = (email) => String(email).replace(/^(.).*(@.*)$/, "$1***$2");

createServer(async (request, response) => {
  const reply = (status, payload) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
  };
  if (request.method === "GET" && request.url === "/health") return reply(200, { ok: true });
  if (request.method !== "POST" || request.url !== "/send") return reply(404, { error: "not found" });

  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64 * 1024) return reply(413, { error: "too large" });
  }
  if (!verify(request.headers, body)) return reply(401, { error: { http_code: 401, message: "bad signature" } });

  let payload;
  try { payload = JSON.parse(body); } catch { return reply(400, { error: { http_code: 400, message: "bad json" } }); }
  const data = payload.email_data ?? {};
  const type = data.email_action_type === "signup" ? "signup" : "magiclink";
  const to = payload.user?.email;
  if (!to || !data.token) return reply(400, { error: { http_code: 400, message: "missing recipient or token" } });

  const message = render(type, data);
  try {
    const id = await sendVia(FROM_PRIMARY, to, message);
    log("sent", { via: "primary", type, to: maskEmail(to), id });
    return reply(200, {});
  } catch (primaryError) {
    log("primary_failed", { type, to: maskEmail(to), error: String(primaryError.message ?? primaryError) });
    try {
      const id = await sendVia(FROM_FALLBACK, to, message);
      log("sent", { via: "fallback", type, to: maskEmail(to), id });
      return reply(200, {});
    } catch (fallbackError) {
      log("failed", { type, to: maskEmail(to), error: String(fallbackError.message ?? fallbackError) });
      return reply(502, { error: { http_code: 502, message: "Could not send the email. Please try again in a minute." } });
    }
  }
}).listen(Number(PORT), () => log("listening", { port: Number(PORT) }));
