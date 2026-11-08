// boks-link-preview: link previews for messengers that cannot reach the site.
//
// The site runs on a server in Russia, and Telegram's servers cannot reach it
// (nor it them: see deploy/telegram-relay), so a tryboks.com link sent in
// Telegram previews as nothing. Cloudflare reaches both. A link shared as
// https://go.tryboks.com/<path> is answered here:
//
// - a link-preview bot gets the page from tryboks.com as it is, with the
//   preview image's address moved to this host, so the bot can fetch it too;
// - a person is sent straight on to https://tryboks.com/<path>.
//
// Nothing is stored here; the site stays the only source of the page.

const bots =
  /TelegramBot|WhatsApp|facebookexternalhit|Facebot|Twitterbot|vkShare|Slackbot|Discordbot|LinkedInBot|Viber|SkypeUriPreview|redditbot|Embedly|Pinterest|Applebot|Iframely|YandexBot|Googlebot|bingbot|OdklBot|Mail\.RU_Bot|bot\b|crawler|spider|preview/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const site = env.SITE_URL;
    const target = `${site}${url.pathname}${url.search}`;
    const agent = request.headers.get("User-Agent") || "";

    if (!bots.test(agent)) {
      return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store" } });
    }

    const upstream = await fetch(target, {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers: { "User-Agent": agent, Accept: request.headers.get("Accept") || "*/*" },
      redirect: "follow",
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    const type = upstream.headers.get("Content-Type") || "";
    const headers = new Headers({ "Cache-Control": "public, max-age=300" });
    if (type) headers.set("Content-Type", type);

    if (!type.startsWith("text/html")) {
      for (const name of ["Content-Length", "ETag", "Last-Modified"]) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    // A bot gets a small page of its own: the preview tags and nothing else,
    // whole, with its length. The app's page is 20+ KB of scripts streamed in
    // chunks, and Telegram fetched it and showed nothing (2026-11-08).
    // Every address in it points here - the image and the page's own address
    // (og:url, canonical) - since the bot cannot reach tryboks.com.
    const here = `${url.protocol}//${url.host}`;
    const local = (value) => (value && value.startsWith(site) ? here + value.slice(site.length) : value);
    const tags = [];
    let title = "";
    await new HTMLRewriter()
      .on("meta[property], meta[name]", {
        element(element) {
          const key = element.getAttribute("property") || element.getAttribute("name");
          const content = element.getAttribute("content");
          if (content != null && /^(og:|twitter:|description$)/.test(key)) tags.push([element.hasAttribute("property") ? "property" : "name", key, local(content)]);
        },
      })
      .on("title", { text(chunk) { title += chunk.text; } })
      .transform(upstream)
      .arrayBuffer();

    const escape = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const page = local(`${site}${url.pathname}`);
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escape(title.trim() || "boks")}</title>${tags
      .map(([kind, key, content]) => `<meta ${kind}="${escape(key)}" content="${escape(content)}">`)
      .join("")}<link rel="canonical" href="${escape(page)}"></head><body><a href="${escape(target)}">${escape(title.trim() || "boks")}</a></body></html>`;
    const body = new TextEncoder().encode(html);
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Content-Length", String(body.byteLength));
    return new Response(request.method === "HEAD" ? null : body, { status: upstream.status, headers });
  },
};
