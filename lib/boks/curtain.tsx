import { getBokPosterArtwork, bokArtworkFocus } from "@/components/boks/reader/bok-artwork";
import { seriesPieceFor } from "@/components/boks/series/series-catalogue";

/**
 * The curtain link card (approved 2026-11-10): a bok's cover behind the boks
 * curtain, its title and byline below. Every published bok has one with no
 * work by anyone - a new bok gets it from its own cover, or a quiet dark
 * ground without one.
 *
 * One scene, three renderings, all by `next/og` in the app:
 *   - `poster`: 1200x630 JPEG for og:image (`/b/<id>/image`), on request;
 *   - `art` and `text`: 960x504 layers for the server job (`deploy/curtain/`),
 *     which lays the 85 shared curtain phases between them into a 10 s MP4
 *     (`/b/<id>/loop.mp4`, og:video). Video is never encoded in a request.
 * The shared layers - curtain, yellow bar, knob, the word boks - are
 * `public/share/curtain/`. Scene coordinates are the handoff's 1920x1008.
 */

/** Bump to redraw every card and loop (it is part of the key). */
export const curtainTemplate = "curtain-1";
export const curtainPosterSize = { width: 1200, height: 630 } as const;
export const curtainLoopSize = { width: 960, height: 504 } as const;
export const curtainOverlay = "/share/curtain/overlay-1200x630.png";
export const curtainFonts = { title: "/share/fonts/boks-preview-serif-450.ttf", byline: "/share/fonts/noto-sans.ttf" } as const;

const stage = { width: 1920, height: 1008, artLeft: 352 };
const ink = "#f7f6ef";
const ground = "#1c242a";

/**
 * Hand-set windows on a cover, as CSS object-position, kept apart from the
 * reader's crop because the curtain shows a different window. Optional: a bok
 * without one uses its series focus, or its reader focus.
 */
const curtainPosition: Record<string, string> = {
  "cc7e3800-3567-42c1-ba08-8554a345e25c": "50% 82%", // коса
  "6c74c9da-dca3-4a16-b238-12c93242dc1f": "50% 80%", // из возвращения в побег
  "c79992b0-37ea-41f9-a2c8-cc645a3b43b7": "50% 84%", // память шва
  "4c517503-f15f-4602-9d29-e1ac34cbbfad": "50% 85%", // азбука веры
  "12794275-b2ca-48ea-a1a0-4fa1f3dd0a07": "50% 70%", // у горы Мегиддо
  "4eb182a0-770e-4b95-9059-07a31b229d78": "50% 42%", // розы Сарагосы
};

export type CurtainCard = {
  id: string;
  title: string;
  byline: string | null;
  /** An application-owned JPEG path, or null for the plain ground. */
  art: string | null;
  position: string;
  /** Changes whenever anything drawn changes: names the stored loop. */
  key: string;
};

/** The card for a published bok, from trusted data only (`loadBokForShare`). */
export function curtainCardFor(bok: { id: string; title: string; authorName?: string | null }): CurtainCard {
  const title = bok.title.replace(/\s+/g, " ").trim();
  const byline = bok.authorName?.replace(/\s+/g, " ").trim() || null;
  const art = getBokPosterArtwork(bok.id);
  const position = curtainPosition[bok.id] ?? seriesPieceFor(bok.id)?.coverFocus ?? bokArtworkFocus(bok.id);
  const key = hash([curtainTemplate, bok.id, title, byline ?? "", art ?? "", position].join("\u0000"));
  return { id: bok.id, title, byline, art, position, key };
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

/**
 * Width of a title in em, from the title font's measured averages
 * (Boks Preview Serif 450), tracking included. Slightly generous, so a title
 * judged to fit on one line does.
 */
function titleEm(text: string) {
  let em = 0;
  for (const char of text) {
    if (char === " ") em += 0.24;
    else if (/[а-яё]/.test(char)) em += 0.63;
    else if (/[a-z]/.test(char)) em += 0.55;
    else if (/[А-ЯЁA-Z]/.test(char)) em += 0.75;
    else em += 0.6;
  }
  return em - 0.045 * Math.max(0, [...text].length - 1);
}

/**
 * The title's size in scene px: 106 if it fits one line, down to 72; else 74
 * on two lines, cut with an ellipsis (at a word if one is near) when even two
 * would not hold it. The full title stays in the page's metadata.
 */
export function curtainTitleLayout(title: string) {
  const room = 1183;
  for (let size = 106; size >= 72; size -= 2) if (titleEm(title) * size <= room) return { size, lines: 1 as const, text: title };
  const size = 74;
  const budget = room * 2 * 0.92;
  if (titleEm(title) * size <= budget) return { size, lines: 2 as const, text: title };
  const units = [...title];
  while (units.length && titleEm(`${units.join("")}…`) * size > budget) units.pop();
  let cut = units.join("");
  const word = cut.slice(0, cut.lastIndexOf(" "));
  if (word.length > cut.length * 0.7) cut = word;
  return { size, lines: 2 as const, text: `${cut.replace(/[\s,.;:—–-]+$/u, "")}…` };
}

type Layer = "poster" | "art" | "text";

/** Width and height of a baseline or progressive JPEG, from its frame header; null if unreadable. */
export function jpegSize(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: (bytes[at + 7] << 8) | bytes[at + 8], height: (bytes[at + 5] << 8) | bytes[at + 6] };
    }
    at += 2 + length;
  }
  return null;
}

/**
 * Where the cover sits in its window: scaled to cover it, then moved by the
 * position's percentages within the room it has. Done here, not with CSS
 * object-position, which the image renderer does not apply.
 */
export function curtainArtBox(art: { width: number; height: number }, window: { width: number; height: number }, position: string) {
  const scale = Math.max(window.width / art.width, window.height / art.height);
  const width = Math.ceil(art.width * scale);
  const height = Math.ceil(art.height * scale);
  const [x, y] = position.split(/\s+/).map((part) => {
    const value = Number.parseFloat(part);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value / 100)) : 0.5;
  });
  return { width, height, left: -Math.round((width - window.width) * (x ?? 0.5)), top: -Math.round((height - window.height) * (y ?? 0.5)) };
}

/**
 * The scene for `ImageResponse`. `artwork` and `overlay` are data URLs the
 * route loaded from application-owned paths; nothing from the request.
 */
export function CurtainScene({ card, layer, width, artwork, overlay }: { card: CurtainCard; layer: Layer; width: number; artwork?: { url: string; width: number; height: number }; overlay?: string }) {
  const s = width / stage.width;
  const height = Math.round(stage.height * s);
  const { size, lines, text } = curtainTitleLayout(card.title);
  const window = { width: width - Math.round(stage.artLeft * s), height };
  const box = artwork ? curtainArtBox(artwork, window, card.position) : null;
  const showArt = layer !== "text";
  const showText = layer !== "art";
  return (
    <div style={{ display: "flex", position: "relative", width, height, background: showArt ? ground : "transparent", overflow: "hidden" }}>
      {showArt && artwork && box && (
        <div style={{ display: "flex", position: "absolute", left: width - window.width, top: 0, width: window.width, height, overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws this into the image. */}
          <img src={artwork.url} alt="" width={box.width} height={box.height} style={{ position: "absolute", left: box.left, top: box.top, width: box.width, height: box.height }} />
        </div>
      )}
      {layer === "poster" && overlay && (
        // eslint-disable-next-line @next/next/no-img-element -- the shared curtain, bar, knob and word.
        <img src={overlay} alt="" width={width} height={height} style={{ position: "absolute", left: 0, top: 0, width, height }} />
      )}
      {showText && (
        <div
          style={{
            position: "absolute",
            left: Math.round(76 * s),
            width: Math.round(1183 * s),
            // The last line's baseline sits at 784 + 0.8 em, as in the handoff; longer titles grow upward.
            bottom: Math.round((stage.height - (784 + 0.9295 * size)) * s),
            display: "block",
            fontFamily: "CurtainTitle",
            fontSize: Math.round(size * s),
            lineHeight: 0.96,
            letterSpacing: -0.045 * size * s,
            color: ink,
            textShadow: `0 ${Math.max(1, Math.round(3 * s))}px ${Math.round(5 * s)}px rgba(11,8,7,.75)`,
            whiteSpace: lines === 1 ? "nowrap" : "normal",
            wordBreak: lines === 2 && text.split(" ").some((word) => titleEm(word) * size > 1183) ? "break-all" : "normal",
            lineClamp: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {text}
        </div>
      )}
      {showText && card.byline && (
        <div
          style={{
            position: "absolute",
            left: Math.round(81 * s),
            top: Math.round(928 * s),
            width: Math.round(1183 * s),
            display: "block",
            fontFamily: "CurtainSans",
            fontSize: Math.round(34 * s),
            lineHeight: 1,
            color: ink,
            textShadow: `0 ${Math.max(1, Math.round(3 * s))}px ${Math.round(5 * s)}px rgba(11,8,7,.75)`,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {card.byline}
        </div>
      )}
    </div>
  );
}
