/**
 * What a shared boks looks like in a messenger.
 *
 * A link to `/b/<id>` used to preview as "boks" and nothing else: the route was
 * a client-side redirect, so the HTML a crawler fetched carried no title, no
 * description and no image. Telegram, WhatsApp and Slack never run the
 * redirect - they read the server's markup once - which meant the most
 * shareable thing in the product, one short poem, arrived as a bare link.
 *
 * The shaping lives here, apart from the page, because it is the part with
 * rules: what a preview may say, how long it may be, and what it must never do
 * (leak a piece that is not published, or fail the page when the lookup fails).
 */

/** Long enough to carry an opening, short enough that no client truncates it. */
export const shareDescriptionLimit = 200;

export type SharedBok = {
  id: string;
  title: string;
  authorName: string | null;
  text: string;
  minutes: number;
  language: string | null;
  /** The bok's readable address, `/b/<slug>` (`20261109100000_boks_bok_slugs.sql`). */
  slug: string | null;
};

const uuidPrefix = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * The bok id in a `/b/...` path segment, even when a messenger damaged it.
 *
 * Found in the wild on the second day: the share button handed the system share
 * sheet both a text and a URL, Telegram joined them with no space, and a link
 * went out as `/b/a1e3baf7-…-088f1cdfbd26Read "Конкурс" on boks`. Telegram
 * links everything up to the first space, so the id arrived as `…cdfbd26Read`,
 * matched nothing, and the card was the bare word "boks". The share button no
 * longer sends text, but links already in chats are what they are - so the id is
 * read as the UUID the segment starts with, and whatever follows is ignored.
 */
export function sharedBokIdFrom(segment: string) {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // A malformed escape is still worth reading as far as it goes.
  }
  const match = decoded.trim().match(uuidPrefix);
  return match ? match[0].toLowerCase() : decoded;
}

/** "«Title» — Author", which is how a reader would say it out loud. */
export function shareTitle(bok: Pick<SharedBok, "title" | "authorName">) {
  const title = bok.title.trim() || "A bok";
  const author = (bok.authorName ?? "").trim();
  return author ? `${title} — ${author}` : title;
}

/** How many lines of a poem a preview opens with. */
export const shareDescriptionLines = 4;

/** Lines no longer than this, at the start of a text, make it verse. */
const verseLineLength = 80;

/**
 * The opening of the piece, as a messenger shows it under the title.
 *
 * A poem keeps its lines: the first few, each on its own line, and an ellipsis
 * after the last one shown - run together, verse read as a garbled sentence
 * (Telegram, WhatsApp and VK all show line breaks in a description). Prose is
 * one paragraph, cut at a word. Either way a text that fits is shown whole,
 * with no ellipsis after it.
 */
export function shareDescription(text: string, limit = shareDescriptionLimit) {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const opening = lines.slice(0, shareDescriptionLines);
  if (lines.length >= 2 && opening.every((line) => line.length <= verseLineLength)) {
    const shown: string[] = [];
    let length = 0;
    for (const line of opening) {
      if (shown.length && length + line.length + 1 > limit) break;
      shown.push(line);
      length += line.length + 1;
    }
    if (shown.length === lines.length) return shown.join("\n");
    shown[shown.length - 1] = `${shown[shown.length - 1].replace(/[\s.,;:—–-]+$/, "")}…`;
    return shown.join("\n");
  }

  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit + 1);
  const lastSpace = cut.lastIndexOf(" ");
  // Cut at a word, unless the first word is longer than the whole allowance.
  const head = lastSpace > limit / 2 ? cut.slice(0, lastSpace) : flat.slice(0, limit);
  return `${head.replace(/[\s,;:—–-]+$/, "")}…`;
}

/** "2 minutes · Russian", the line under a preview's title. */
export function shareReadingNote(bok: Pick<SharedBok, "minutes" | "language">) {
  const minutes = Math.max(1, Math.round(bok.minutes || 1));
  const length = `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const language = bok.language === "ru" ? "Russian" : bok.language === "en" ? "English" : null;
  return language ? `${length} · ${language}` : length;
}

type PreviewRow = {
  id?: unknown;
  title?: unknown;
  author_name?: unknown;
  text?: unknown;
  minutes?: unknown;
  language?: unknown;
  slug?: unknown;
};

export function sharedBokFromRow(row: PreviewRow | null | undefined): SharedBok | null {
  if (!row || typeof row.id !== "string") return null;
  const text = typeof row.text === "string" ? row.text : "";
  if (!text.trim()) return null;
  return {
    id: row.id,
    title: typeof row.title === "string" ? row.title : "",
    authorName: typeof row.author_name === "string" && row.author_name.trim() ? row.author_name : null,
    text,
    minutes: Number(row.minutes) || 1,
    language: typeof row.language === "string" ? row.language : null,
    slug: typeof row.slug === "string" && row.slug ? row.slug : null,
  };
}

const slugShape = /^[a-z0-9]+(?:-[a-z0-9]+)*/;

/**
 * What a `/b/...` segment names: a bok id, or a bok's slug (`/b/neznakomka-blok`).
 * A slug is read as far as it is a slug, so text a messenger glued onto the
 * link (`neznakomka-blokЧитай`) is left behind, as `sharedBokIdFrom` does for ids.
 */
export function sharedBokRefFrom(segment: string): { id: string } | { slug: string } | null {
  const id = sharedBokIdFrom(segment);
  if (uuidPrefix.test(id)) return { id };
  const slug = id.trim().toLowerCase().match(slugShape)?.[0];
  return slug && slug.length <= 80 ? { slug } : null;
}

/**
 * Reads one published boks with the publishable key, for the preview only.
 *
 * `published_boks` is what `anon` may read, so a draft or a hidden piece cannot
 * reach a preview by construction rather than by a filter here. Bounded at two
 * seconds and swallowing every failure: a messenger waiting on us is a link
 * that previews as nothing, and a reader waiting on us is worse - the page has
 * to render either way.
 */
export async function loadBokForShare(
  id: string,
  options: { url?: string; key?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<SharedBok | null> {
  const url = options.url ?? (import.meta.env.VITE_SUPABASE_URL as string | undefined);
  const key = options.key ?? (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined);
  const filter = /^[0-9a-f-]{36}$/i.test(id) ? `id=eq.${id}` : /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.length <= 80 ? `slug=eq.${id}` : null;
  if (!url || !key || !filter) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2000);
  try {
    const restBase = options.url ? `${url}/rest/v1` : (globalThis.process?.env?.BOKS_INTERNAL_REST_URL || `${url}/rest/v1`);
    const request = `${restBase}/published_boks?${filter}&select=id,title,author_name,text,minutes,language,slug&limit=1`;
    const response = await (options.fetchImpl ?? fetch)(request, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as PreviewRow[];
    return sharedBokFromRow(Array.isArray(rows) ? rows[0] : null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
