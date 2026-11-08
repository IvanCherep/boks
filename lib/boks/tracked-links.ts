import { shareOrigin } from "@/lib/boks/share-link";

/**
 * Tracked links: a link an admin makes for one place - a faculty chat, a
 * university newsletter - so the console can say what that link brought.
 *
 * The link is an ordinary share link with a code on it, `/b/<id>?link=<code>`,
 * or `/?link=<code>` for the home page. The `/b` page carries the code across
 * its redirect, the reader sends it with the visit, and the database keeps it
 * only if an admin created it (`create_tracked_link`). What each link brought
 * is `get_link_attribution`.
 */

const bokIdPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const bokIdShape = new RegExp(`^${bokIdPattern.source}$`, "i");
const linkCodeShape = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** A bok id, exactly, lower-cased - or null. */
export function bokIdFrom(value: string | null | undefined) {
  const id = value?.trim().toLowerCase() ?? "";
  return bokIdShape.test(id) ? id : null;
}

/**
 * The bok id in whatever an admin pasted: the id itself, a `/b/<id>` link
 * copied from the reader, or a `/?bok=<id>` address. Null when there is none.
 */
/** A bok slug in what an admin pasted: `go.tryboks.com/b/kosa-prokhorov`, or the slug alone. */
export function bokSlugFromInput(input: string) {
  const text = input.trim().toLowerCase();
  const fromLink = text.match(/\/b\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:[/?#]|$)/)?.[1];
  const bare = /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(text) ? text : null;
  const slug = fromLink ?? bare;
  return slug && slug.length <= 80 ? slug : null;
}

export function bokIdFromInput(input: string) {
  const match = input.match(bokIdPattern);
  return match ? match[0].toLowerCase() : null;
}

/** A tracked link's code, lower-cased, or null if it cannot be one. Mirrors the database's check. */
export function linkCodeFrom(value: string | null | undefined) {
  const code = value?.trim().toLowerCase() ?? "";
  return linkCodeShape.test(code) ? code : null;
}

/** The address to send. A link with a bok opens it; one without opens the feed. */
export function trackedLinkUrl(origin: string, link: { code: string; bokId: string | null; bokSlug?: string | null }) {
  // On go.tryboks.com like every shared link, so it previews in Telegram
  // (`share-link.ts`), and by the bok's slug once it is known.
  const base = shareOrigin(origin).replace(/\/+$/, "");
  const code = encodeURIComponent(link.code);
  const bok = link.bokSlug || link.bokId;
  return bok ? `${base}/b/${bok}?link=${code}` : `${base}/?link=${code}`;
}
