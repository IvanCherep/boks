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

    // The preview image must come from here too: the bot cannot reach the site.
    const here = `${url.protocol}//${url.host}`;
    const move = (element) => {
      const value = element.getAttribute("content");
      if (value && value.startsWith(site)) element.setAttribute("content", here + value.slice(site.length));
    };
    return new HTMLRewriter()
      .on('meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"], meta[name="twitter:image"]', { element: move })
      .transform(new Response(upstream.body, { status: upstream.status, headers }));
  },
};
