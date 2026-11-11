import { curtainCardFor } from "@/lib/boks/curtain";
import { authorPortraitFor } from "@/components/boks/author-portraits";

/**
 * The ribbon link card (boks-ribbon-backend-kit, 2026-11-11): the cover full
 * bleed, the title and byline, and the yellow boks ribbon that coils around
 * the title, leaves, passes huge across the card and parks under the small
 * boks again. 11.4 s, silent.
 *
 * One card for any bok or author, from data alone. The app only describes it
 * (`ribbonCardForBok`, `ribbonCardForAuthor`, served as `.../ribbon/card` to
 * the job); the server job `deploy/ribbon/` draws the poster and the loop with
 * Skia and ffmpeg, once per key, and stores them privately. The app serves
 * the stored files after its publication check and never draws or encodes
 * anything for it in a request.
 *
 * Under test (2026-11-11): only `/b/<bok>/ribbon` and `/a/<handle>/ribbon`
 * preview with it, and the job makes cards only for the targets it is given
 * (`deploy/ribbon/ribbon.mjs`). Rolling it out is pointing the main pages at
 * `ribbonPreview` and giving the job `b:*`.
 */

/** Bump to redraw every ribbon card (it is part of the key). Change with deploy/ribbon/motion.mjs or scene.mjs. */
export const ribbonTemplate = "ribbon-1";
export const ribbonPosterSize = { width: 1200, height: 630 } as const;
export const ribbonLoopSize = { width: 960, height: 504 } as const;

export type RibbonKind = "work" | "author";

/** What the job needs to draw a card. Text is text; `art` is an application-owned path. */
export type RibbonCard = {
  kind: RibbonKind;
  /** A bok id, or an author's handle. */
  ref: string;
  title: string;
  byline: string;
  art: string | null;
  /** Where the window sits on the cover, as CSS object-position fractions (0..1). */
  position: { x: number; y: number };
  /** How dark the cover gets under the text, 0..1. */
  shade: number;
  /** Names the stored files; changes with anything drawn. */
  key: string;
};

const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/** "50% 42%" -> {x: .5, y: .42}; anything else is the centre. */
export function positionFrom(css: string | null | undefined) {
  const match = /^\s*(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*$/.exec(css ?? "");
  const fraction = (value: string | undefined) => Math.max(0, Math.min(1, Number(value) / 100));
  return match ? { x: fraction(match[1]), y: fraction(match[2]) } : { x: 0.5, y: 0.5 };
}

function keyOf(card: Omit<RibbonCard, "key">) {
  return hash([ribbonTemplate, card.kind, card.ref, card.title, card.byline, card.art ?? "", card.position.x, card.position.y, card.shade].join("\u0000"));
}

/** FNV-1a, 32 bits, as 8 hex digits: a name for a file, not a security boundary. */
function hash(text: string) {
  let value = 0x811c9dc5;
  for (const char of text) {
    value ^= char.codePointAt(0)!;
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}

/** The card of a published bok, from trusted data only (`loadBokForShare`). */
export function ribbonCardForBok(bok: { id: string; title: string; authorName?: string | null }): RibbonCard {
  // The same cover and window as the curtain card, hand-set crops included.
  const { art, position } = curtainCardFor(bok);
  const card = {
    kind: "work" as const,
    ref: bok.id,
    title: clean(bok.title) || "boks",
    byline: clean(bok.authorName),
    art,
    position: positionFrom(position),
    shade: art ? 0.62 : 0.3,
  };
  return { ...card, key: keyOf(card) };
}

/**
 * The card of an author: a registered ribbon picture (`authorPortraits`,
 * `ribbonArt`), else the photo they set, else none (the page keeps its
 * ordinary preview).
 */
export function ribbonCardForAuthor(author: { handle: string; name: string; photoVersion?: number | null }): RibbonCard | null {
  const portrait = authorPortraitFor(author.handle);
  const art = portrait?.ribbonArt?.path ?? (author.photoVersion ? `/a/${author.handle}/photo?v=${author.photoVersion}` : null);
  if (!art) return null;
  const card = {
    kind: "author" as const,
    ref: author.handle,
    title: portrait ? `${portrait.given} ${portrait.family}` : clean(author.name) || `@${author.handle}`,
    byline: `@${author.handle}`,
    art,
    position: portrait?.ribbonArt?.position ?? { x: 0.5, y: 0.3 },
    shade: 0.1,
  };
  return { ...card, key: keyOf(card) };
}

/**
 * Where the job stores a card's files: `ribbon/<b|a>-<ref>-<key>.<mp4|jpg>` in
 * the private file store the app reads link-only pieces from
 * (`BOKS_LINK_ONLY_BASE_URL`, internal only). Null where there is none.
 */
export function ribbonFileUrl(card: Pick<RibbonCard, "kind" | "ref" | "key">, ext: "mp4" | "jpg") {
  const base = globalThis.process?.env?.BOKS_LINK_ONLY_BASE_URL;
  if (!base || !/^[0-9a-z_.-]{1,40}$/.test(card.ref) || !/^[0-9a-f]{8}$/.test(card.key)) return null;
  return `${base.replace(/\/+$/, "")}/ribbon/${ribbonFileName(card)}.${ext}`;
}

export function ribbonFileName(card: Pick<RibbonCard, "kind" | "ref" | "key">) {
  return `${card.kind === "work" ? "b" : "a"}-${card.ref}-${card.key}`;
}

/** Whether both files are stored: a quick internal HEAD each, never a reason to hold a page. */
export async function ribbonReady(card: RibbonCard, timeoutMs = 400) {
  const urls = [ribbonFileUrl(card, "jpg"), ribbonFileUrl(card, "mp4")];
  if (urls.some((url) => !url)) return false;
  try {
    const answers = await Promise.all(urls.map((url) => fetch(url!, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) })));
    return answers.every((answer) => answer.ok);
  } catch {
    return false;
  }
}

/**
 * The tags of a page that previews with the ribbon, or null while its files
 * are not made yet (then the page keeps its ordinary preview). `base` is the
 * page's own path (`/b/<id>`, `/a/<handle>`); the files hang under it.
 */
export async function ribbonPreview(card: RibbonCard | null, base: string, origin: string) {
  if (!card || !(await ribbonReady(card))) return null;
  return {
    image: { url: `${origin}${base}/ribbon/poster.jpg?v=${card.key}`, ...ribbonPosterSize, type: "image/jpeg" as const },
    video: { url: `${origin}${base}/ribbon/loop.mp4?v=${card.key}`, ...ribbonLoopSize },
  };
}

/** The description the job reads (`.../ribbon/card`): what to draw, nothing else. */
export function ribbonJobCard(card: RibbonCard) {
  return { kind: card.kind, ref: card.ref, title: card.title, byline: card.byline, hasArt: Boolean(card.art), position: card.position, shade: card.shade, key: card.key, name: ribbonFileName(card) };
}

/**
 * A stored file, for a route: the bytes from the private store, ranges passed
 * through. 404 while it is not made.
 */
export async function serveRibbonFile(card: RibbonCard | null, file: "poster.jpg" | "loop.mp4", request: Request) {
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const source = card ? ribbonFileUrl(card, file === "loop.mp4" ? "mp4" : "jpg") : null;
  if (!source) return notFound();
  const range = request.headers.get("Range");
  let upstream: Response;
  try {
    upstream = await fetch(source, { headers: range ? { Range: range } : undefined, signal: AbortSignal.timeout(10_000) });
  } catch {
    return new Response("Unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  if (upstream.status === 404 || upstream.status === 400) return notFound();
  if (!upstream.ok) return new Response("Unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
  const headers = new Headers({
    "Content-Type": file === "loop.mp4" ? "video/mp4" : "image/jpeg",
    // Like the curtain loop: never kept anywhere, so a bok hidden later is not given out.
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  });
  for (const name of ["Content-Length", "Content-Range", "ETag", "Last-Modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
